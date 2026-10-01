import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCiLm8GJPbAOg-7HujoAXqRckeqsyGKEy0",
    authDomain: "portal-flexia.firebaseapp.com",
    projectId: "portal-flexia",
    storageBucket: "portal-flexia.firebasestorage.app",
    messagingSenderId: "45461412433",
    appId: "1:45461412433:web:ebaa722ebc6de98a9ef670"
};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);