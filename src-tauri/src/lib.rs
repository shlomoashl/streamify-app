use tauri::Manager;

// פונקציה שמורה לווינדוס להשאיר את האפליקציה ערה ופעילה ברקע,
// מה שמאפשר למסך להיכבות כרגיל (מסך שחור) אך מונע מהמוזיקה להתנתק או להעצר.
#[cfg(target_os = "windows")]
fn prevent_windows_sleep() {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
    }
}

// פונקציית הכניסה הראשית ללוגיקה של האפליקציה
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // הפעלת חסימת מצב שינה בווינדוס מיד עם הרצת הפונקציה
    #[cfg(target_os = "windows")]
    prevent_windows_sleep();

    tauri::Builder::default()
        .setup(|app| {
            // תיקון: הוספנו קו תחתון למשתנה שלא בשימוש כדי למנוע אזהרות בנייה
            let window = app.get_window("main");
            if let Some(_window) = window {
                #[cfg(debug_assertions)]
                _window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}