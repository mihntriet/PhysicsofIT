// ============================================================
// Firebase Client Configuration
// ============================================================
// Cấu hình Firebase cho Front-end (Auth + Realtime Database).
// Thay các giá trị placeholder bằng config từ Firebase Console.
//
// Lấy config: Firebase Console → Project Settings → General
//           → Your apps → Firebase SDK snippet → Config
// ============================================================

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL: 'https://YOUR_PROJECT_ID.firebaseio.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Khởi tạo Firebase App
firebase.initializeApp(firebaseConfig);

// Export các services
const auth = firebase.auth();
const database = firebase.database();
