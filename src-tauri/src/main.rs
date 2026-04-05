#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// מפנה לפונקציה run שנמצאת ב-lib.rs
// זה המבנה הנכון לפרויקטים מודרניים של Tauri
fn main() {
    streamify_lib::run();
}