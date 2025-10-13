// public/firebase-config.js
// ──────────────────────────────────────────
// Firebase 設定を「名前付きエクスポート」で公開する
// ──────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyDlpw9zV4coV6QoWNvQjQNuRJZyCamPOwI",
  authDomain: "missioncompass-3b58e.firebaseapp.com",
  projectId: "missioncompass-3b58e",
  storageBucket: "missioncompass-3b58e.firebasestorage.app",
  messagingSenderId: "131331323629",
  appId: "1:131331323629:web:d3569e87cfc769b739fee4",
  measurementId: "G-6QPMD953N7"
};

// もし他のページから <script src="/firebase-config.js"> として読みたい場合は、
// window.firebaseConfig = firebaseConfig; を追加してもOK。
// （今回は ES Module で import しているので不要）
