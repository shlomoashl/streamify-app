import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { checkUpdate, installUpdate } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { ConfirmModalState } from '../components/Modals';

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
        const res = await fetch(
            'https://api.github.com/repos/shlomoashl/streamify-app/releases/latest'
        );
        if (!res.ok) return;

        const data = await res.json();
        const updateAsset = data.assets?.find((a: any) => a.name === 'update.zip');

        if (updateAsset) {
            const serverDate = new Date(updateAsset.updated_at).getTime();
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
    setGlobalLoading('מוריד עדכון פנימי...');

    try {
        setUpdateStatusMsg('1/5: מחפש עדכון מול שרתי גיטהאב...');
        await delay(500);

        const res = await fetch(
            `https://api.github.com/repos/shlomoashl/streamify-app/releases/latest?nocache=${Date.now()}`
        );
        if (!res.ok) throw new Error('שגיאה בקבלת נתוני גרסה מגיטהאב');

        const data = await res.json();
        const tagName = data.tag_name;
        if (!tagName) throw new Error('לא נמצאה תגית גרסה תקינה בשרת');

        setUpdateStatusMsg(`2/5: נמצאה גרסה ${tagName}! מנתח נתוני שרת...`);
        await delay(1000);

        const updateAsset = data.assets?.find((a: any) => a.name === 'update.zip');
        if (!updateAsset) throw new Error('קובץ update.zip לא נמצא בשרת');

        const serverDate = new Date(updateAsset.updated_at).getTime();
        const downloadUrl = updateAsset.browser_download_url;

        setUpdateStatusMsg(`3/5: מוריד את גרסה ${tagName}...`);
        const result = await CapacitorUpdater.download({
            url: downloadUrl,
            version: tagName
        });

        localStorage.setItem('streamify_pending_update', serverDate.toString());
        setUpdateAvailable(false);

        setUpdateStatusMsg('4/5: העדכון ירד בהצלחה. מכין להפעלה הבאה...');
        await delay(1000);

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
        await delay(1500);

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
        }, 4000);
    }
};
