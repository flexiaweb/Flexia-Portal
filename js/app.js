import { auth, db } from "./firebase-config.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  deleteUser,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, 
  setDoc,
  query,
  where, 
  getDoc,
  getDocs, 
  collection, 
  addDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Variable global temporal para retener el usuario mientras completa la organización
let pendingUser = null;

// Evitar bucles si el usuario está en medio del registro por pasos
onAuthStateChanged(auth, async (user) => {
  if (user && !pendingUser) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        window.location.href = "./pages/dashboard.html";
      }
    } catch (error) {
      console.error("Error comprobando sesión activa:", error);
    }
  }
});

// Helper para mostrar errores en pantalla.
function showErrorMessage(message, formId) {
  const form = document.getElementById(formId);
  const errorDiv = form.querySelector('#error-message') || form.querySelector('#org-error-message');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// Helper para generar el código principal (FLP_ + 6 dígitos aleatorios)
function generarCodigoPrincipal() {
  let numeroAleatorio = '';
  for (let i = 0; i < 6; i++) {
    numeroAleatorio += Math.floor(Math.random() * 10).toString();
  }
  return `FLP_${numeroAleatorio}`;
}

// Helper para mostrar un modal web de confirmación personalizado
function showConfirmModal(orgName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("org-confirm-modal");
    const textEl = document.getElementById("modal-org-text");
    const btnConfirm = document.getElementById("btn-confirm-join");
    const btnCancel = document.getElementById("btn-cancel-join");

    textEl.textContent = `Este CIF pertenece a la organización "${orgName}". ¿Estás seguro de que quieres unirte a ella?`;
    modal.style.display = "flex";

    const handleConfirm = () => {
      modal.style.display = "none";
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.style.display = "none";
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      btnConfirm.removeEventListener("click", handleConfirm);
      btnCancel.removeEventListener("click", handleCancel);
    };

    btnConfirm.addEventListener("click", handleConfirm);
    btnCancel.addEventListener("click", handleCancel);
  });
}

// Helper para mostrar un modal web de éxito personalizado
function showSuccessModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("org-success-modal");
    const titleEl = document.getElementById("modal-success-title");
    const textEl = document.getElementById("modal-success-text");
    const btnOk = document.getElementById("btn-success-ok");

    titleEl.textContent = title;
    textEl.textContent = message;
    modal.style.display = "flex";

    const handleOk = () => {
      modal.style.display = "none";
      btnOk.removeEventListener("click", handleOk);
      resolve();
    };

    btnOk.addEventListener("click", handleOk);
  });
}

// --- 1. PASO 1: REGISTRO DE CREDENCIALES DE USUARIO ---
const registerForm = document.getElementById("register-form");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(password)) {
      showErrorMessage("La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.", "register-form");
      return;
    }

    try {
      // Creamos el usuario en Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      pendingUser = userCredential.user;

      // Limpiamos errores previos del paso 2 si los hubiera
      const orgError = document.getElementById("org-error-message");
      if (orgError) orgError.style.display = 'none';

      // Cambiamos a la siguiente vista dentro del mismo index.html para pedir Organización y CIF
      switchView('org-setup-view');

    } catch (error) {
      showErrorMessage("Error al registrar: Usuario ya Creado", "register-form");
    }
  });
}

// --- 1.1. BOTÓN DE CANCELAR EN CONFIGURACIÓN DE ORGANIZACIÓN ---
const btnCancelSetup = document.getElementById("btn-cancel-setup");
if (btnCancelSetup) {
  btnCancelSetup.addEventListener("click", async () => {
    if (confirm("¿Estás seguro de que deseas cancelar? Se descartará la cuenta creada.")) {
      try {
        if (pendingUser) {
          await deleteUser(pendingUser);
          pendingUser = null;
        }
        switchView('register-view');
      } catch (error) {
        console.error("Error al eliminar el usuario pendiente:", error);
        pendingUser = null;
        switchView('register-view');
      }
    }
  });
}

// --- 1.2. PASO 2: CONFIGURACIÓN DE ORGANIZACIÓN Y CIF ---
const orgSetupForm = document.getElementById("org-setup-form");
if (orgSetupForm) {
  orgSetupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!pendingUser) {
      showErrorMessage("No hay una sesión de usuario pendiente. Vuelve a registrarte.", "org-setup-form");
      return;
    }

    const orgName = document.getElementById("org-setup-name").value.trim();
    const orgCif = document.getElementById("org-setup-cif").value.trim().toUpperCase();

    try {
      // Consultamos si el CIF ya existe en la base de datos
      const q = query(collection(db, "organizations"), where("cif", "==", orgCif));
      const querySnapshot = await getDocs(q);

      let organizationId;
      let roleType = "admin";

      if (!querySnapshot.empty) {
        const existingOrgDoc = querySnapshot.docs[0];
        const existingOrgData = existingOrgDoc.data();

        const confirmed = await showConfirmModal(existingOrgData.name);
        
        if (!confirmed) {
          return; 
        }

        organizationId = existingOrgDoc.id;
        roleType = "member";
      } else {
        // Se crea la organización incluyendo el codigoPrincipal generado aleatoriamente
        const orgRef = await addDoc(collection(db, "organizations"), {
          name: orgName,
          cif: orgCif,
          ownerEmail: pendingUser.email,
          codigoPrincipal: generarCodigoPrincipal(),
          createdAt: serverTimestamp(),
          plan: "free"
        });
        organizationId = orgRef.id;
        roleType = "admin";
      }

      await setDoc(doc(db, "users", pendingUser.uid), {
        email: pendingUser.email,
        organizationId: organizationId,
        cif: orgCif,
        role: roleType,
        createdAt: serverTimestamp()
      });

      // Limpiamos la referencia temporal al terminar con éxito
      pendingUser = null;

      const successTitle = roleType === "admin" ? "¡Organización creada!" : "¡Te has unido con éxito!";
      const successMsg = roleType === "admin" 
        ? "La entidad se ha registrado correctamente en Flexia Portal." 
        : "Te has asociado a la organización existente de forma correcta.";

      await showSuccessModal(successTitle, successMsg);
      window.location.href = "./pages/dashboard.html";

    } catch (error) {
      showErrorMessage("Error al configurar la organización: " + error.message, "org-setup-form");
    }
  });
}

// --- 2. INICIO DE SESIÓN ---
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      // Configuramos persistencia local para permitir múltiples pestañas abiertas simultáneamente
      await setPersistence(auth, browserLocalPersistence);
      
      // Registramos el momento exacto del login para el control de 24 horas en auth-check.js
      localStorage.setItem("timestamp_sesion", new Date().getTime().toString());

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        window.location.href = "./pages/dashboard.html";
      } else {
        alert("El usuario no tiene un perfil asociado en la base de datos.");
      }

    } catch (error) {
      let msg = "Credenciales incorrectas.";
      if (error.code === 'auth/user-not-found') msg = "Usuario no registrado.";
      if (error.code === 'auth/wrong-password') msg = "Contraseña incorrecta.";
      
      showErrorMessage(msg, "login-form");
    }
  });
}

// --- 3. RECUPERACIÓN DE CONTRASEÑA ---
const resetForm = document.getElementById("reset-form");
if (resetForm) {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("reset-email").value.trim();

    try {
      await sendPasswordResetEmail(auth, email);
      alert("Se ha enviado un enlace de recuperación a tu correo electrónico.");
      switchView('login-view');
    } catch (error) {
      console.error("Error al enviar correo de recuperación:", error);
      alert("No se pudo enviar el correo: " + error.message);
    }
  });
}

// --- 4. TOGGLE PARA VISIBILIDAD DE CONTRASEÑA ---
document.querySelectorAll('.btn-toggle-password').forEach(button => {
  button.addEventListener('click', () => {
    const inputWrapper = button.closest('.input-wrapper');
    const passwordInput = inputWrapper ? inputWrapper.querySelector('input') : null;
    
    if (passwordInput) {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
      } else {
        passwordInput.type = 'password';
      }
    }
  });
});