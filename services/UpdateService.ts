import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { ConfirmModalState } from '../components/Modals';
import { ApkVersionInfo, StreamifyMediaPlugin } from '../types';
import { YOUTUBE_API_BASE } from '../constants';

const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');

const BUILT_WEB_VERSION_CODE = Number(import.meta.env.VITE_VERSION_CODE || 0);
const BUILT_WEB_VERSION = String(import.meta.env.VITE_APP_VERSION || '');

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
 * חישוב מדויק של מספר הגרסה הפעיל כעת באנדרואיד (הגבוה מבין ה-APK המותקן, הפרונט המובנה, וה-OTA האחרון)
 */
const getEffectiveAndroidState = async (): Promise<{
    currentVersionCode: number;
    currentVersionTag: string;
    apkInfo: ApkVersionInfo | null;
}> => {
    let apkInfo: ApkVersionInfo | null = null;
    try {
        apkInfo = await StreamifyMedia.getApkInfo();
    } catch {
        try {
            const capInfo = await CapacitorApp.getInfo();
            apkInfo = {
                versionCode: Number(capInfo.build || 1),
                versionName: capInfo.version || '1.0',
                nativeSignature: 'legacy'
            };
        } catch {}
    }

    const apkCode = Number(apkInfo?.versionCode || 0);
    const savedOtaCode = Number(localStorage.getItem('streamify_installed_ota_code') || 0);
    const currentVersionCode = Math.max(apkCode, BUILT_WEB_VERSION_CODE, savedOtaCode);

    let currentVersionTag = BUILT_WEB_VERSION || '';
    if (savedOtaCode > BUILT_WEB_VERSION_CODE) {
        currentVersionTag = localStorage.getItem('streamify_installed_ota_tag') || currentVersionTag;
    }
    if (!currentVersionTag && apkInfo?.versionName) {
        currentVersionTag = apkInfo.versionName.startsWith('v')
            ? apkInfo.versionName
            : `v${apkInfo.versionName}`;
    }

    return { currentVersionCode, currentVersionTag, apkInfo };
};

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

        // חילוץ מספר הגרסה גם מתוך תגית ה-Release (למשל v1.0.158 -> 158) כגיבוי אם אין version.json
        let fallbackCode: number | undefined = manifestJson.versionCode;
        if (!fallbackCode && data.tag_name) {
            const parts = String(data.tag_name).replace(/^v/i, '').split('.');
            const lastNum = Number(parts[parts.length - 1]);
            if (!isNaN(lastNum) && lastNum > 0) fallbackCode = lastNum;
        }

        return {
            version: data.tag_name || '',
            versionCode: fallbackCode,
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

const evaluateAndroidUpdateNeed = (
    releaseInfo: LatestReleaseInfo,
    state: {
        currentVersionCode: number;
        currentVersionTag: string;
        apkInfo: ApkVersionInfo | null;
    }
): {
    hasUpdate: boolean;
    requiresFullApk: boolean;
} => {
    const remoteCode = Number(releaseInfo.versionCode || 0);
    const localCode = Number(state.currentVersionCode || 0);

    // 1. בדיקת השוואת מספרי גרסה ישירה ומדויקת (לא תלויה בתאריכים שגויים!)
    let hasUpdate = false;
    if (remoteCode > 0 && localCode > 0) {
        hasUpdate = remoteCode > localCode;
    } else if (releaseInfo.version && state.currentVersionTag) {
        hasUpdate = releaseInfo.version !== state.currentVersionTag;
    } else if (releaseInfo.zipUpdatedAt) {
        const serverDate = new Date(releaseInfo.zipUpdatedAt).getTime();
        const localDate = parseInt(localStorage.getItem('streamify_app_version_date') || '0', 10);
        hasUpdate = serverDate > localDate;
    }

    if (!hasUpdate) {
        return { hasUpdate: false, requiresFullApk: false };
    }

    // 2. אם יש עדכון — קובעים האם נדרש עדכון APK מלא (שינוי ב-Native / פלאגינים) או עדכון פרונט קצר
    let requiresFullApk = false;
    const localNativeSig = state.apkInfo?.nativeSignature;
    const remoteNativeSig = releaseInfo.nativeSignature;
    const apkCode = Number(state.apkInfo?.versionCode || 0);

    if (remoteNativeSig && localNativeSig) {
        if (localNativeSig === 'legacy') {
            requiresFullApk = remoteCode > apkCode;
        } else if (remoteNativeSig !== localNativeSig) {
            requiresFullApk = remoteCode === 0 || remoteCode > apkCode;
        }
    }

    return {
        hasUpdate: true,
        requiresFullApk: requiresFullApk && releaseInfo.hasApk
    };
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
                    const apkCode = Number(info.build || 0);
                    if (apkCode > 0) {
                        localStorage.setItem('streamify_installed_ota_code', String(apkCode));
                    }
                    setUpdateAvailable(false);
                }
            })
            .catch(() => {});

        CapacitorUpdater.current()
            .then((c) => console.log('Current bundle on app start:', c))
            .catch(console.error);

        const pendingOtaCode = localStorage.getItem('streamify_pending_ota_code');
        const pendingOtaTag = localStorage.getItem('streamify_pending_ota_tag');
        if (pendingOtaCode) {
            localStorage.setItem('streamify_installed_ota_code', pendingOtaCode);
            if (pendingOtaTag) {
                localStorage.setItem('streamify_installed_ota_tag', pendingOtaTag);
            }
            localStorage.removeItem('streamify_pending_ota_code');
            localStorage.removeItem('streamify_pending_ota_tag');
            setUpdateAvailable(false);
        }

        const pendingUpdate = localStorage.getItem('streamify_pending_update');
        if (pendingUpdate) {
            localStorage.setItem('streamify_app_version_date', pendingUpdate);
            localStorage.removeItem('streamify_pending_update');
            setUpdateAvailable(false);
        }
    }
};

const PENDING_APK_RESUME_KEY = 'streamify_apk_resume_pending';

interface InteractiveCallbacks {
    setGlobalLoading: (msg: string | null) => void;
    setUpdateStatusMsg: (msg: string) => void;
    setUpdateAvailable: (val: boolean) => void;
    setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}

const executeApkDownloadAndInstall = async (
    releaseInfo: LatestReleaseInfo,
    callbacks: InteractiveCallbacks
) => {
    const { setGlobalLoading, setUpdateStatusMsg, setUpdateAvailable, setConfirmModal } = callbacks;
    const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');

    setGlobalLoading('מוריד קובץ עדכון מערכת (APK)...');
    setUpdateStatusMsg('מתחבר לשרת העדכונים (0%)...');

    let progressHandle: { remove: () => Promise<void> } | null = null;
    try {
        progressHandle = await StreamifyMedia.addListener('onMediaEvent', (evt: any) => {
            if (evt?.action === 'apkDownloadProgress') {
                setUpdateStatusMsg(`מוריד קובץ עדכון מערכת: ${evt.value}%`);
            } else if (evt?.action === 'apkPermissionNeeded') {
                // שומרים חותמת זמן למקרה שאנדרואיד יאתחל את תהליך האפליקציה בזמן אישור ההרשאה בהגדרות
                localStorage.setItem(PENDING_APK_RESUME_KEY, String(Date.now()));
                setGlobalLoading('ממתין לאישור התקנה בהגדרות אנדרואיד...');
                setUpdateStatusMsg('יש לאשר "התקנת אפליקציות לא מוכרות" בהגדרות ולחזור — ההתקנה תמשיך אוטומטית');
            } else if (evt?.action === 'apkPermissionGranted') {
                localStorage.removeItem(PENDING_APK_RESUME_KEY);
                setGlobalLoading('מוריד קובץ עדכון מערכת (APK)...');
                setUpdateStatusMsg('ההרשאה אושרה! ממשיך בהורדת העדכון...');
            }
        });

        const serverProxyApkUrl = `${cleanBase}/app-update-download?type=apk&t=${Date.now()}`;
        await StreamifyMedia.downloadAndInstallApk({
            url: serverProxyApkUrl,
            fallbackUrl: releaseInfo.apkDownloadUrl || ''
        });

        localStorage.removeItem(PENDING_APK_RESUME_KEY);
        const serverDate = releaseInfo.apkUpdatedAt
            ? new Date(releaseInfo.apkUpdatedAt).getTime()
            : Date.now();
        localStorage.setItem('streamify_app_version_date', serverDate.toString());
        setUpdateAvailable(false);
        setGlobalLoading(null);
        setUpdateStatusMsg('');
    } catch (apkErr: any) {
        localStorage.removeItem(PENDING_APK_RESUME_KEY);
        setGlobalLoading(null);
        setUpdateStatusMsg('');
        setConfirmModal({
            isOpen: true,
            title: 'שגיאה בהורדת עדכון המערכת',
            message: apkErr?.message || 'לא הצלחנו להוריד את קובץ העדכון.',
            onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
            isAlertOnly: true
        });
    } finally {
        if (progressHandle) {
            progressHandle.remove().catch(() => {});
        }
    }
};

export const resumePendingApkInstallIfReady = async (callbacks: InteractiveCallbacks) => {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const rawTs = localStorage.getItem(PENDING_APK_RESUME_KEY);
        if (!rawTs) return;
        const ts = Number(rawTs);
        // תקף ל-5 דקות בלבד — למקרה שמערכת אנדרואיד הפעילה מחדש את התהליך בזמן מתן ההרשאה
        if (!ts || Date.now() - ts > 5 * 60 * 1000) {
            localStorage.removeItem(PENDING_APK_RESUME_KEY);
            return;
        }

        const perm = await StreamifyMedia.canRequestPackageInstalls().catch(() => ({ granted: false }));
        if (!perm?.granted) {
            localStorage.removeItem(PENDING_APK_RESUME_KEY);
            return;
        }

        localStorage.removeItem(PENDING_APK_RESUME_KEY);
        const [releaseInfo, localState] = await Promise.all([
            fetchLatestReleaseMetadata(true),
            getEffectiveAndroidState()
        ]);
        if (!releaseInfo) return;

        const { hasUpdate, requiresFullApk } = evaluateAndroidUpdateNeed(releaseInfo, localState);
        if (hasUpdate && requiresFullApk) {
            await executeApkDownloadAndInstall(releaseInfo, callbacks);
        }
    } catch (e) {
        localStorage.removeItem(PENDING_APK_RESUME_KEY);
        console.warn('[UpdateService] resumePendingApkInstallIfReady warning:', e);
    }
};

export const checkAndroidUpdateAvailabilitySilently = async (
    setUpdateAvailable: (val: boolean) => void
) => {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const [releaseInfo, localState] = await Promise.all([
            fetchLatestReleaseMetadata(false),
            getEffectiveAndroidState()
        ]);
        if (!releaseInfo) return;

        const { hasUpdate } = evaluateAndroidUpdateNeed(releaseInfo, localState);
        setUpdateAvailable(hasUpdate);
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
    setGlobalLoading('מחפש עדכונים...');

    try {
        setUpdateStatusMsg('1/5: בודק גרסה מול השרת...');
        await delay(250);

        const [releaseInfo, localState] = await Promise.all([
            fetchLatestReleaseMetadata(true),
            getEffectiveAndroidState()
        ]);

        if (!releaseInfo || !releaseInfo.version) {
            throw new Error('לא הצלחנו לקבל נתוני גרסה מהשרת');
        }

        const tagName = releaseInfo.version;
        const { hasUpdate, requiresFullApk } = evaluateAndroidUpdateNeed(releaseInfo, localState);

        // 0. בדיקה בדיוק כמו בווינדוס: אם כבר מעודכן - עוצרים ומודיעים "הכל מעודכן"!
        if (!hasUpdate) {
            setUpdateAvailable(false);
            setGlobalLoading(null);
            setUpdateStatusMsg('');
            setConfirmModal({
                isOpen: true,
                title: 'הכל מעודכן',
                message: `יש לך כבר את הגרסה העדכנית ביותר (${tagName}).`,
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
            return;
        }

        // מסלול א': עדכון מערכת מלא (APK — שינוי ב-Native / פלאגינים)
        if (requiresFullApk) {
            setGlobalLoading(null);
            setUpdateStatusMsg('');

            setConfirmModal({
                isOpen: true,
                title: `עדכון מערכת מלא זמין (${tagName})`,
                message:
                    'עדכון זה כולל שדרוג לרכיבי הנגן המובנים והפלאגינים באנדרואיד (התקנת APK). האם להוריד ולהתקין כעת (ללא מחיקת נתונים)?',
                onConfirm: () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    void executeApkDownloadAndInstall(releaseInfo, callbacks);
                }
            });
            return;
        }

        // מסלול ב': עדכון פרונט קצר ומהיר בלבד (update.zip ללא החלפת APK)
        setGlobalLoading(null);
        setUpdateStatusMsg('');

        setConfirmModal({
            isOpen: true,
            title: `עדכון פרונט מהיר זמין (${tagName})`,
            message:
                'עדכון זה כולל שיפורי ממשק בלבד (ללא צורך בהתקנת APK). האם להתקין כעת?',
            onConfirm: async () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                setGlobalLoading('מוריד עדכון פנימי...');

                try {
                    setUpdateStatusMsg(`2/5: מכין עדכון פנימי לגרסה ${tagName}...`);
                    await delay(400);

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
                    if (releaseInfo.versionCode) {
                        localStorage.setItem(
                            'streamify_pending_ota_code',
                            String(releaseInfo.versionCode)
                        );
                    }
                    localStorage.setItem('streamify_pending_ota_tag', tagName);
                    setUpdateAvailable(false);

                    setUpdateStatusMsg('4/5: העדכון ירד בהצלחה. מכין להפעלה הבאה...');
                    await delay(600);

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
                    await delay(1000);

                    setGlobalLoading(null);
                    CapacitorApp.exitApp();
                } catch (otaErr: any) {
                    localStorage.removeItem('streamify_pending_update');
                    localStorage.removeItem('streamify_pending_ota_code');
                    localStorage.removeItem('streamify_pending_ota_tag');
                    setUpdateStatusMsg(`שגיאה: ${otaErr.message}`);

                    setTimeout(() => {
                        setGlobalLoading(null);
                        setUpdateStatusMsg('');
                        setConfirmModal({
                            isOpen: true,
                            title: 'שגיאת עדכון',
                            message: otaErr.message || 'שגיאה לא ידועה.',
                            onConfirm: () =>
                                setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                            isAlertOnly: true
                        });
                    }, 2500);
                }
            }
        });
    } catch (e: any) {
        setGlobalLoading(null);
        setUpdateStatusMsg('');
        setConfirmModal({
            isOpen: true,
            title: 'שגיאת עדכון',
            message: e.message || 'לא הצלחנו לבדוק עדכונים מול השרת.',
            onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
            isAlertOnly: true
        });
    }
};
