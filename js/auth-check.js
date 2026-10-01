import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const TIEMPO_MAXIMO_SESION = 24 * 60 * 60 * 1000;

// --- FUNCIÓN PARA MOSTRAR MODALES GLOBALES DE BLOQUEO ---
function mostrarModalBloqueo(titulo, mensaje, textoBoton, onCerrar) {
  let modalOverlay = document.getElementById("modalBloqueoGlobal");

  if (!modalOverlay) {
    modalOverlay = document.createElement("div");
    modalOverlay.id = "modalBloqueoGlobal";
    modalOverlay.className = "modal-overlay";
    modalOverlay.style.cssText = "display: flex; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(5px); z-index: 9999; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalOverlay);
  }

  modalOverlay.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 420px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.5rem 1.75rem; background: #fff; border-radius: 0.875rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.35rem; font-weight: 600; color: #0f172a;">${titulo}</h3>
      <p style="font-size: 0.95rem; color: #475569; margin-bottom: 1.75rem; line-height: 1.5;">${mensaje}</p>
      <button type="button" id="btnCerrarModalBloqueo" style="width: 100%; padding: 0.7rem; background: #ef4444; color: #fff; border: none; border-radius: 0.5rem; font-weight: 500; font-size: 0.95rem; cursor: pointer; transition: background 0.2s;">${textoBoton}</button>
    </div>
  `;

  modalOverlay.style.display = "flex";

  const btnCerrar = document.getElementById("btnCerrarModalBloqueo");
  btnCerrar.onclick = async () => {
    modalOverlay.style.display = "none";
    if (onCerrar) await onCerrar();
  };
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("timestamp_sesion");
    localStorage.removeItem("recordar_sesion");
    window.location.href = "../index.html";
  } else {
    try {
      const ahora = new Date().getTime();
      const ultimoLogin = localStorage.getItem("timestamp_sesion");

      if (ultimoLogin && (ahora - parseInt(ultimoLogin) > TIEMPO_MAXIMO_SESION)) {
        await signOut(auth);
        localStorage.removeItem("timestamp_sesion");
        window.location.href = "../index.html";
        return;
      }

      if (!ultimoLogin) {
        localStorage.setItem("timestamp_sesion", ahora.toString());
      }

      // Comprobamos si el documento del usuario existe en Firestore
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        mostrarModalBloqueo(
          "Cuenta no encontrada",
          "Tu cuenta ha sido eliminada de la organización o ya no existe un registro asociado en el sistema.",
          "Aceptar y salir",
          async () => {
            try {
              await user.delete();
            } catch (errAuth) {
              console.warn("No se pudo autoeliminar de Auth, cerrando sesión...", errAuth);
              await signOut(auth);
            }
            localStorage.removeItem("timestamp_sesion");
            window.location.href = "../index.html";
          }
        );
        return;
      }

      const userData = userDoc.data();
      const orgId = userData.organizationId || userData.orgId || userData.companyId;

      // --- VALIDACIÓN DE ACCESO / USUARIO PENDIENTE ---
      let esOwner = false;
      if (orgId) {
        try {
          const orgDocRef = doc(db, "organizations", orgId);
          const orgDocSnap = await getDoc(orgDocRef);
          if (orgDocSnap.exists()) {
            const orgData = orgDocSnap.data();
            const ownerEmailOrg = orgData.ownerEmail || orgData.email || orgData.adminEmail;
            if (ownerEmailOrg && user.email && (user.email.toLowerCase() === ownerEmailOrg.toLowerCase())) {
              esOwner = true;
            }
          }
        } catch (e) {
          console.warn("No se pudo verificar si es owner:", e);
        }
      }

      if (!esOwner && userData.activo !== true) {
        mostrarModalBloqueo(
          "Acceso Pendiente",
          "Tu cuenta está pendiente de aprobación por el administrador de la organización. No puedes acceder todavía.",
          "Entendido y salir",
          async () => {
            await signOut(auth);
            localStorage.removeItem("timestamp_sesion");
            window.location.href = "../index.html";
          }
        );
        return;
      }

    } catch (error) {
      console.error("Error al validar el perfil del usuario:", error);
    }
  }
});

// --- GESTIÓN DEL CONTADOR VISIBLE DE LA SESIÓN ---
document.addEventListener("DOMContentLoaded", () => {
  const loginTimestampStr = localStorage.getItem("timestamp_sesion");
  const badge = document.getElementById("session-info-badge");

  if (!loginTimestampStr || !badge) return;

  const loginTime = parseInt(loginTimestampStr, 10);
  const expirationTime = loginTime + TIEMPO_MAXIMO_SESION;

  const actualizarTexto = () => {
    const ahora = new Date().getTime();
    const tiempoRestante = expirationTime - ahora;

    if (tiempoRestante <= 0) {
      badge.textContent = "Sesión caducada. Redirigiendo...";
      return;
    }

    const horas = Math.floor(tiempoRestante / (1000 * 60 * 60));
    const minutos = Math.floor((tiempoRestante % (1000 * 60 * 60)) / (1000 * 60));
    
    const fechaExpiracion = new Date(expirationTime);
    const horaExpiracion = fechaExpiracion.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    badge.textContent = `Sesión activa (Cierre en aprox. ${horas}h ${minutos}m, a las ${horaExpiracion})`;
  };

  actualizarTexto();
  setInterval(actualizarTexto, 60000);
});