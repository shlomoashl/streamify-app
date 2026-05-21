#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// פונקציה שמורה לווינדוס להשאיר את האפליקציה ערה ברקע
#[cfg(target_os = "windows")]
fn prevent_windows_sleep() {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
    unsafe {
        // הדגל ES_SYSTEM_REQUIRED מונע מווינדוס להקפיא או להרדים את המעבד עבור האפליקציה הזו,
        // אך הוא מאפשר למסך עצמו להיכבות כרגיל (מסך שחור).
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
    }
}

fn main() {
  // הפעלת חסימת השינה של ווינדוס מיד עם עליית התוכנה
  #[cfg(target_os = "windows")]
  prevent_windows_sleep();

  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}