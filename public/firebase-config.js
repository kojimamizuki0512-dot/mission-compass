// Firebase Web v9+ (Modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// ↓↓↓ コンソール > プロジェクトの設定 > マイアプリ > Webアプリ の Config を丸ごと貼る ↓↓↓
const firebaseConfig = {
  apiKey: "AIzaSyDlpw9zV4coV6QoWNvQjQNuRJZyCamPOwI",
  authDomain: "missioncompass-3b58e.firebaseapp.com",
  projectId: "missioncompass-3b58e",
  storageBucket: "missioncompass-3b58e.firebasestorage.app",
  messagingSenderId: "131331323629",
  appId: "1:131331323629:web:d3569e87cfc769b739fee4",
  measurementId: "G-6QPMD953N7"
};
// ↑↑↑ ここまで ↑↑↑

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// 使い方例：importして dialog.html のスクリプトで signIn/signOut を呼ぶ
export async function signInWithGoogle() {
  await signInWithPopup(auth, provider);
}
export async function signOutAll() {
  await signOut(auth);
}
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}
