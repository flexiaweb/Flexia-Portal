import { auth, db } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. INYECCIÓN AUTOMÁTICA DE LA CABECERA Y NAVEGACIÓN
function injectHeader() {
  const headerContainer = document.getElementById("appHeaderContainer");
  if (headerContainer) {
    headerContainer.innerHTML = `
      <header class="top-app-header">
        <div class="brand-logo">
          <svg class="brand-svg-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z"/>
          </svg>
          <span class="brand-title">Flexia<span> Portal</span></span>
        </div>
        
        <div class="sidebar-footer">
          <div class="user-profile-badge" id="userProfileBadge">
            <div class="user-avatar-mini" id="userAvatarInitials">US</div>
            <div class="user-info">
              <span class="user-name" id="userNameDisplay">Cargando...</span>
              <span class="user-role" id="userOrgDisplay">Cargando...</span>
            </div>
            
            <div class="footer-inline-actions">
              <button class="btn-help-icon" id="btnNotificacionesHeader" title="Notificaciones" style="position: relative;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              </button>
              
              <button class="btn-help-icon" id="btnHelp" title="Centro de Ayuda">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              </button>
              
              <button class="btn-logout-icon" id="btnLogout" title="Cerrar Sesión">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </button>
            </div>
          </div>
        </div>
      </header>
    `;
    
    setupHeaderEvents();
  }
}

// Configuración de los eventos del header
function setupHeaderEvents() {
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "../index.html";
      } catch (error) {
        console.error("Error al cerrar sesión:", error);
      }
    });
  }

  const btnHelp = document.getElementById("btnHelp");
  if (btnHelp) {
    btnHelp.addEventListener("click", () => {
      window.location.href = "./ayuda.html";
    });
  }

  const btnNotificacionesHeader = document.getElementById("btnNotificacionesHeader");
  if (btnNotificacionesHeader) {
    btnNotificacionesHeader.addEventListener("click", () => {
      window.location.href = "./notificaciones.html";
    });
  }
}

// Inyectar al cargar el DOM inmediatamente
document.addEventListener("DOMContentLoaded", () => {
  injectHeader();
});

// Listener único y robusto de autenticación
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      injectHeader();

      const userEmail = user.email || "Usuario";
      const nameDisplay = document.getElementById("userNameDisplay");
      const orgDisplay = document.getElementById("userOrgDisplay");
      const initialsDisplay = document.getElementById("userAvatarInitials");

      if (nameDisplay) nameDisplay.textContent = userEmail;

      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const orgId = userData.organizationId || userData.orgId || userData.companyId;

        if (orgId) {
          const orgDocRef = doc(db, "organizations", orgId);
          const orgDoc = await getDoc(orgDocRef);

          if (orgDoc.exists()) {
            const orgData = orgDoc.data();
            const orgName = orgData.name || orgData.organizationName || "Organización";
            if (orgDisplay) orgDisplay.textContent = orgName;
          } else {
            if (orgDisplay) orgDisplay.textContent = "Organización no encontrada";
          }

          // Cargamos la configuración de cuotas y evaluamos las alertas con un pequeño margen para asegurar el DOM
          setTimeout(async () => {
            const conceptosCache = await cargarConceptosConfigHeader(orgId);
            verificarAlertasCabecera(orgId, conceptosCache);
          }, 150);

        } else {
          const directOrgName = userData.organizationName || userData.orgName;
          if (orgDisplay) {
            orgDisplay.textContent = directOrgName || "Sin organización";
          }
        }

        if (initialsDisplay) {
          const initials = userEmail.substring(0, 2).toUpperCase();
          initialsDisplay.textContent = initials;
        }
      } else {
        if (orgDisplay) orgDisplay.textContent = "Sin perfil";
      }
    } catch (error) {
      console.error("Error al cargar los datos del usuario y organización:", error);
    }
  }
});

// --- FUNCIONES AUXILIARES DE CARGA Y CÁLCULO IDÉNTICAS AL MÓDULO DE NOTIFICACIONES ---

async function cargarConceptosConfigHeader(orgId) {
  try {
    const q = query(collection(db, "cuotas_config"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);
    const conceptosCache = {};

    snap.forEach(docSnap => {
      const data = docSnap.data();
      conceptosCache[docSnap.id] = data;
      if (data.nombre) {
        conceptosCache[data.nombre.toLowerCase().trim()] = data;
      }
    });
    return conceptosCache;
  } catch (error) {
    console.error("Error cargando cuotas_config para la cabecera:", error);
    return {};
  }
}

async function verificarAlertasCabecera(orgId, conceptosCache) {
  try {
    const q = query(collection(db, "pagos"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let contadorRojos = 0;
    const ultimosPagosPorSocio = {};

    snap.forEach(docSnap => {
      const pago = docSnap.data();
      const socioIdKey = pago.socioId || pago.socioNombre || "desconocido";

      // Buscamos la configuración de la cuota igual que en notificaciones.js
      let configCuota = null;
      if (pago.cuotaId && conceptosCache[pago.cuotaId]) {
        configCuota = conceptosCache[pago.cuotaId];
      } else if (pago.nombreCuota && conceptosCache[pago.nombreCuota.toLowerCase().trim()]) {
        configCuota = conceptosCache[pago.nombreCuota.toLowerCase().trim()];
      }

      const periodicidad = configCuota ? parseInt(configCuota.periodicidad, 10) : (parseInt(pago.periodicidad, 10) || 0);
      const tipoUnidad = configCuota ? (configCuota.tipoUnidad || 'meses') : (pago.tipoUnidad || 'meses');

      const proximoCobroFecha = calcularSiguienteFechaSimple(pago.fechaPago, periodicidad, tipoUnidad);
      const timestampActual = new Date(pago.fechaPago || "1970-01-01").getTime();

      if (!ultimosPagosPorSocio[socioIdKey] || timestampActual > ultimosPagosPorSocio[socioIdKey].timestamp) {
        ultimosPagosPorSocio[socioIdKey] = {
          pagoData: pago,
          timestamp: timestampActual,
          proximoCobroFecha: proximoCobroFecha
        };
      }
    });

    Object.values(ultimosPagosPorSocio).forEach(item => {
      const proximoCobroFecha = item.proximoCobroFecha;
      
      if (proximoCobroFecha && !proximoCobroFecha.includes("Pago único") && !proximoCobroFecha.includes("inválida")) {
        const partes = proximoCobroFecha.split('-');
        const fechaVenc = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
        const diferenciaDias = Math.ceil((fechaVenc - hoy) / (1000 * 60 * 60 * 24));

        if (diferenciaDias <= 0) {
          contadorRojos++;
        }
      }
    });

    actualizarBadgeNotificacionesHeader(contadorRojos);

  } catch (error) {
    console.error("Error al comprobar las alertas de la cabecera:", error);
  }
}

function actualizarBadgeNotificacionesHeader(cantidad) {
  const btnNotif = document.getElementById("btnNotificacionesHeader");
  if (!btnNotif) {
    console.warn("El botón btnNotificacionesHeader aún no está disponible en el DOM.");
    return;
  }

  // Buscamos el icono SVG dentro del botón
  const svgIcon = btnNotif.querySelector("svg");

  if (cantidad > 0) {
    // Estilos para el botón
    btnNotif.style.backgroundColor = "#fee2e2";
    btnNotif.style.borderColor = "#f87171";
    btnNotif.style.color = "#991b1b";

    // Si hay icono SVG, cambiamos su color de trazo a rojo oscuro
    if (svgIcon) {
      svgIcon.style.stroke = "#991b1b";
    }

    // Añadimos un pequeño punto rojo de aviso si no existe ya
    let dot = btnNotif.querySelector(".notification-dot");
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "notification-dot";
      dot.style.cssText = `
        position: absolute;
        top: 2px;
        right: 2px;
        width: 8px;
        height: 8px;
        background-color: #ef4444;
        border-radius: 50%;
        border: 1px solid white;
      `;
      btnNotif.appendChild(dot);
    }
  } else {
    // Restauramos estados normales si no hay alertas
    btnNotif.style.backgroundColor = "";
    btnNotif.style.borderColor = "";
    btnNotif.style.color = "";

    if (svgIcon) {
      svgIcon.style.stroke = "";
    }

    const dot = btnNotif.querySelector(".notification-dot");
    if (dot) {
      dot.remove();
    }
  }
}

function calcularSiguienteFechaSimple(fechaPagoStr, periodicidad, tipoUnidad) {
  if (!fechaPagoStr || isNaN(periodicidad) || periodicidad <= 0) {
    return "Pago único / Sin definir";
  }

  const partes = fechaPagoStr.split('-');
  if (partes.length !== 3) return "Fecha inválida";

  const anio = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1;
  const dia = parseInt(partes[2], 10);

  const fecha = new Date(anio, mes, dia);
  const unidadLimpia = (tipoUnidad || '').toString().toLowerCase().trim();

  if (unidadLimpia.includes('dia')) {
    fecha.setDate(fecha.getDate() + periodicidad);
  } else {
    fecha.setMonth(fecha.getMonth() + periodicidad);
  }

  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}