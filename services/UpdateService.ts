import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { ConfirmModalState } from '../components/Modals';
import { StreamifyMediaPlugin } from '../types';
import { YOUTUBE_API_BASE } from '../constants';

const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');

interface LatestReleaseInfo {
    version: string;
    versionCode?: number;
    nativeSignature?: string;
    zipUpdatedAt?: string;
    apkUpdatedAt?: string;
    zipDownloadUrl?: string;
    apkDownloadUrl?: string;
    hasZip: boolean;
    hasApk: boolean;
}

/**
 * מושך מידע על הגרסה האחרונה דרך שרת הפייתון (עוקף חסימות גיטהאב ברשתות מסוננות) עם גיבוי לגיטהאב ישירות
 */
const fetchLatestReleaseMetadata = async (nocache = false): Promise<LatestReleaseInfo | null> => {
    const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');

    // 1. ניסיון ראשון דרך שרת הפייתון שלנו
    try {
        const serverUrl = `${cleanBase}/app-update-info${nocache ? `?nocache=${Date.now()}` : ''}`;
        const sRes = await fetch(serverUrl);
        if (sRes.ok) {
            const sData = await sRes.json();
            if (sData && sData.success && sData.version) {
                return sData as LatestReleaseInfo;
            }
        }
    } catch (e) {
        console.warn('[UpdateService] Server update-info fallback to GitHub directly:', e);
    }

    // 2. גיבוי ישיר מול GitHub API
    try {
        const ghUrl = `https://api.github.com/repos/shlomoashl/streamify-app/releases/latest${
            nocache ? `?nocache=${Date.now()}` : ''
        }`;
        const res = await fetch(ghUrl);
        if (!res.ok) return null;

        const data = await res.json();
        const zipAsset = data.assets?.find((a: any) => a.name === 'update.zip');
        const apkAsset = data.assets?.find((a: any) => a.name && a.name.endsWith('.apk'));
        const manifestAsset = data.assets?.find((a: any) => a.name === 'version.json');

        let manifestJson: any = {};
        if (manifestAsset?.browser_download_url) {
            try {
                const mRes = await fetch(manifestAsset.browser_download_url);
                if (mRes.ok) manifestJson = await mRes.json();
            } catch {}
        }

        return {
            version: data.tag_name || '',
            versionCode: manifestJson.versionCode,
            nativeSignature: manifestJson.nativeSignature,
            zipUpdatedAt: zipAsset?.updated_at || data.published_at,
            apkUpdatedAt: apkAsset?.updated_at || data.published_at,
            zipDownloadUrl: zipAsset?.browser_download_url,
            apkDownloadUrl: apkAsset?.browser_download_url,
            hasZip: Boolean(zipAsset),
            hasApk: Boolean(apkAsset)
        };
    } catch (e) {
        console.error('[UpdateService] Failed to fetch release metadata:', e);
        return null;
    }
};

export const checkInitialUpdateState = (setUpdateAvailable: (val: boolean) => void) => {
    // 1. Windows Tauri silent check
    if ('__TAURI__' in window) {
        checkUpdate()
            .then(({ shouldUpdate }) => {
                if (shouldUpdate) setUpdateAvailable(true);
            })
            .catch((err) => console.error('שגיאה בבדיקת עדכוני רקע בווינדוס:', err));
    }

    // 2. Android CapacitorUpdater bundle verification
    if (Capacitor.isNativePlatform()) {
        CapacitorUpdater.notifyAppReady().catch(() => {});
        CapacitorApp.getInfo()
            .then((info) => {
                const currentNativeVersion = `${info.version}_${info.build}`;
                const savedNativeVersion = localStorage.getItem('streamify_native_apk_version');
                localStorage.setItem('streamify_native_apk_version', currentNativeVersion);
                if (savedNativeVersion && savedNativeVersion !== currentNativeVersion) {
                    localStorage.setItem('streamify_app_version_date', Date.now().toString());
                    setUpdateAvailable(false);
                }
            })
            .catch(() => {});

        CapacitorUpdater.current()
            .then((c) => console.log('Current bundle on app start:', c))
            .catch(console.error);

        const pendingUpdate = localStorage.getItem('streamify_pending_update');
        if (pendingUpdate) {
            localStorage.setItem('streamify_app_version_date', pendingUpdate);
            localStorage.removeItem('streamify_pending_update');
            setUpdateAvailable(false);
        }
    }
};

export const checkAndroidUpdateAvailabilitySilently = async (
    setUpdateAvailable: (val: boolean) => void
) => {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const releaseInfo = await fetchLatestReleaseMetadata(false);
        if (!releaseInfo) return;

        // 1. בדיקה אם יש שינוי ברכיבי ה-Native/פלאגינים שמחייב עדכון APK
        try {
            const apkInfo = await StreamifyMedia.getApkInfo();
            if (
                releaseInfo.nativeSignature &&
                apkInfo?.nativeSignature &&
                apkInfo.nativeSignature !== 'legacy' &&
                releaseInfo.nativeSignature !== apkInfo.nativeSignature
            ) {
                setUpdateAvailable(true);
                return;
            }
            if (
                releaseInfo.versionCode &&
                apkInfo?.versionCode &&
                apkInfo.nativeSignature === 'legacy' &&
                releaseInfo.versionCode > apkInfo.versionCode
            ) {
                setUpdateAvailable(true);
                return;
            }
        } catch {}

        // 2. בדיקה רגילה של תאריך ה-update.zip לעדכוני פרונט
        if (releaseInfo.zipUpdatedAt) {
            const serverDate = new Date(releaseInfo.zipUpdatedAt).getTime();
            const localDateStr = localStorage.getItem('streamify_app_version_date');

            if (!localDateStr) {
                localStorage.setItem('streamify_app_version_date', serverDate.toString());
                return;
            }

            const localDate = parseInt(localDateStr, 10);
            if (serverDate > localDate) {
                setUpdateAvailable(true);
            }
        }
    } catch (e) {
        console.error('Failed to check for updates silently', e);
    }
};

export const runInteractiveUpdateCheck = async (callbacks: {
    setGlobalLoading: (msg: string | null) => void;
    setUpdateStatusMsg: (msg: string) => void;
    setUpdateAvailable: (val: boolean) => void;
    setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}) => {
    const { setGlobalLoading, setUpdateStatusMsg, setUpdateAvailable, setConfirmModal } = callbacks;

    if (!Capacitor.isNativePlatform()) {
        try {
            setGlobalLoading('מחפש עדכונים ל-Windows...');
            const { shouldUpdate, manifest } = await checkUpdate();

            if (shouldUpdate) {
                setGlobalLoading(null);
                setConfirmModal({
                    isOpen: true,
                    title: 'עדכון גרסה זמין!',
                    message: `נמצאה גרסה חדשה (${manifest?.version}). האם תרצה להתקין ולהפעיל מחדש עכשיו?`,
                    onConfirm: async () => {
                        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                        setGlobalLoading(
                            'מוריד ומתקין את העדכון... האפליקציה תופעל מחדש בסיום.'
                        );
                        await installUpdate();
                        await relaunch();
                    }
                });
            } else {
                setGlobalLoading(null);
                setConfirmModal({
                    isOpen: true,
                    title: 'הכל מעודכן',
                    message: 'יש לך את הגרסה העדכנית ביותר.',
                    onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                    isAlertOnly: true
                });
            }
        } catch (error: any) {
            setGlobalLoading(null);
            alert('פרטי השגיאה: ' + (error?.message || error));
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'לא הצלחנו לבדוק עדכונים. נסה שוב מאוחר יותר.',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        }
        return;
    }

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');
    setGlobalLoading('בודק עדכונים...');

    try {
        setUpdateStatusMsg('1/5: בודק גרסה אחרונה מול השרת...');
        await delay(300);

        const releaseInfo = await fetchLatestReleaseMetadata(true);
        if (!releaseInfo || !releaseInfo.version) {
            throw new Error('לא הצלחנו לקבל נתוני גרסה מהשרת');
        }

        const tagName = releaseInfo.version;

        // בדיקה מול השכבה הנייטיבית של האנדרואיד האם חל שינוי בקוד ה-Java/פלאגינים
        let requiresFullApkUpdate = false;
        try {
            const apkInfo = await StreamifyMedia.getApkInfo();
            if (releaseInfo.nativeSignature && apkInfo?.nativeSignature) {
                if (
                    apkInfo.nativeSignature === 'legacy' ||
                    releaseInfo.nativeSignature !== apkInfo.nativeSignature
                ) {
                    // אם חתימת ה-Native השתנתה ויש גרסה חדשה יותר של ה-APK - נדרש עדכון APK מלא!
                    if (!releaseInfo.versionCode || releaseInfo.versionCode > apkInfo.versionCode) {
                        requiresFullApkUpdate = true;
                    }
                }
            }
        } catch (e) {
            console.warn('[UpdateService] getApkInfo check fallback to OTA:', e);
        }

        // מסלול א': זוהה שינוי בפלאגינים / בקוד ה-Native של האנדרואיד -> הורדת APK והתקנה ישירה!
        if (requiresFullApkUpdate && releaseInfo.hasApk) {
            setGlobalLoading(null);
            setUpdateStatusMsg('');

            setConfirmModal({
                isOpen: true,
                title: `עדכון מערכת מלא זמין (${tagName})`,
                message:
                    'עדכון זה כולל שדרוג לרכיבי הנגן המובנים והפלאגינים באנדרואיד. האם להוריד את קובץ העדכון ולהתקין אותו כעת (ללא מחיקת נתונים)?',
                onConfirm: async () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    setGlobalLoading('מוריד קובץ עדכון מערכת (APK)...');
                    setUpdateStatusMsg('מתחבר לשרת העדכונים (0%)...');

                    let progressHandle: { remove: () => Promise<void> } | null = null;
                    try {
                        progressHandle = await StreamifyMedia.addListener(
                            'onMediaEvent',
                            (evt: any) => {
                                if (evt?.action === 'apkDownloadProgress') {
                                    setUpdateStatusMsg(`מוריד קובץ עדכון: ${evt.value}%`);
                                }
                            }
                        );

                        const serverProxyApkUrl = `${cleanBase}/app-update-download?type=apk&t=${Date.now()}`;
                        await StreamifyMedia.downloadAndInstallApk({
                            url: serverProxyApkUrl,
                            fallbackUrl: releaseInfo.apkDownloadUrl || ''
                        });

                        const serverDate = releaseInfo.apkUpdatedAt
                            ? new Date(releaseInfo.apkUpdatedAt).getTime()
                            : Date.now();
                        localStorage.setItem('streamify_app_version_date', serverDate.toString());
                        setUpdateAvailable(false);
                        setGlobalLoading(null);
                        setUpdateStatusMsg('');
                    } catch (apkErr: any) {
                        setGlobalLoading(null);
                        setUpdateStatusMsg('');
                        setConfirmModal({
                            isOpen: true,
                            title: 'שגיאה בהורדת עדכון המערכת',
                            message: apkErr?.message || 'לא הצלחנו להוריד את קובץ העדכון.',
                            onConfirm: () =>
                                setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                            isAlertOnly: true
                        });
                    } finally {
                        if (progressHandle) {
                            progressHandle.remove().catch(() => {});
                        }
                    }
                }
            });
            return;
        }

        // מסלול ב': עדכון פרונט (React/UI) בלבד -> עדכון פנימי מהיר (update.zip)
        setUpdateStatusMsg(`2/5: נמצאה גרסה ${tagName}! מכין עדכון פנימי...`);
        await delay(500);

        const serverDate = releaseInfo.zipUpdatedAt
            ? new Date(releaseInfo.zipUpdatedAt).getTime()
            : Date.now();
        const serverProxyZipUrl = `${cleanBase}/app-update-download?type=zip&t=${Date.now()}`;
        const downloadUrl = releaseInfo.zipDownloadUrl || serverProxyZipUrl;

        setUpdateStatusMsg(`3/5: מוריד את גרסה ${tagName}...`);
        let result;
        try {
            result = await CapacitorUpdater.download({
                url: serverProxyZipUrl,
                version: tagName
            });
        } catch {
            result = await CapacitorUpdater.download({
                url: downloadUrl,
                version: tagName
            });
        }

        localStorage.setItem('streamify_pending_update', serverDate.toString());
        setUpdateAvailable(false);

        setUpdateStatusMsg('4/5: העדכון ירד בהצלחה. מכין להפעלה הבאה...');
        await delay(800);

        const updaterAny = CapacitorUpdater as any;
        if (typeof updaterAny.next !== 'function') {
            throw new Error(
                'CapacitorUpdater.next לא קיים בגרסת הפלאגין. צריך לעדכן את @capgo/capacitor-updater'
            );
        }

        await updaterAny.next({ id: result.id });
        setUpdateStatusMsg(
            '5/5: העדכון מוכן. סוגר את האפליקציה... פתחו אותה מחדש להשלמת העדכון'
        );
        await delay(1200);

        setGlobalLoading(null);
        CapacitorApp.exitApp();
    } catch (e: any) {
        localStorage.removeItem('streamify_pending_update');
        setUpdateStatusMsg(`שגיאה: ${e.message}`);

        setTimeout(() => {
            setGlobalLoading(null);
            setConfirmModal({
                isOpen: true,
                title: 'שגיאת עדכון',
                message: e.message || 'שגיאה לא ידועה.',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        }, 3000);
    }
};
