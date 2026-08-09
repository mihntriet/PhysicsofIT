// Firebase Web config is public application configuration, not a service-account secret.
// Values below come from the registered Firebase Web App for physics-of-it.
const firebaseConfig = {
  apiKey: "AIzaSyBtb8atwwlU4j4arsXT8nZTZ7M83BHd1j0",
  authDomain: "physics-of-it.firebaseapp.com",
  databaseURL: "https://physics-of-it-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "physics-of-it",
  storageBucket: "physics-of-it.firebasestorage.app",
  messagingSenderId: "376127356707",
  appId: "1:376127356707:web:f4b941db3da567fc771696"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const firestore = firebase.firestore();
