import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';

console.log('🚀 Starting Icon Generation Process...');

// 1. Prepare Capacitor Assets Folder Structure
if (!existsSync('assets')) {
  console.log('📂 Creating assets directory...');
  mkdirSync('assets');
}

if (existsSync('icon.svg')) {
  console.log('✅ Found icon.svg in root');
  // Copy to assets folder for Capacitor
  copyFileSync('icon.svg', 'assets/logo.svg');
  copyFileSync('icon.svg', 'assets/icon.svg');
  copyFileSync('icon.svg', 'assets/splash.svg');
} else {
  console.error('❌ Error: icon.svg not found in the root directory!');
  process.exit(1);
}

// 2. Run Capacitor Assets Generator (Android)
try {
  console.log('📱 Generating Android Icons & Splash...');
  execSync('npx @capacitor/assets generate --android', { stdio: 'inherit', shell: true });
} catch (error) {
  console.error('❌ Failed to generate Android icons:', error.message);
}

// 3. Run Tauri Icon Generator (Windows/Desktop)
try {
  console.log('💻 Generating Windows/Desktop Icons...');
  // FIX: Direct call using npx to ensure the command is found
  execSync('npx @tauri-apps/cli icon icon.svg', { stdio: 'inherit', shell: true });
} catch (error) {
  console.error('❌ Failed to generate Windows icons:', error.message);
  console.log('👉 Make sure you have the src-tauri folder setup correctly.');
}

console.log('✨ Icon generation process finished.');
