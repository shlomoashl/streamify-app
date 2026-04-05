use tauri::Manager;

// פונקציית הכניסה הראשית ללוגיקה של האפליקציה
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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