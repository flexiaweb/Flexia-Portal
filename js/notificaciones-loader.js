import { db, auth } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let pagosConCalculoCache = [];
let conceptosCache = {};
let sociosCache = {}; 

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      currentUserOrgId = userData.organizationId || userData.orgId || userData.companyId;

      if (!currentUserOrgId) {
        console.error("Usuario sin organización asignada.");
        return;
      }

      await cargarConceptosConfig(currentUserOrgId);
      await cargarSociosCache(currentUserOrgId);
      await cargarPagosYCalcularVencimientos(currentUserOrgId);
      inicializarEventosModal();

    } catch (error) {
      console.error("Error al inicializar el módulo de comunicaciones:", error);
    }
  }
});

async function cargarSociosCache(orgId) {
  try {
    const q = query(collection(db, "socios"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);
    sociosCache = {};

    snap.forEach(docSnap => {
      const socioData = docSnap.data();
      sociosCache[docSnap.id] = socioData;
      if (socioData.nombre) {
        sociosCache[socioData.nombre.toLowerCase().trim()] = socioData;
      }
    });
  } catch (error) {
    console.error("Error cargando socios para caché de correos:", error);
  }
}

async function cargarConceptosConfig(orgId) {
  try {
    const q = query(collection(db, "cuotas_config"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);
    conceptosCache = {};

    snap.forEach(docSnap => {
      const data = docSnap.data();
      conceptosCache[docSnap.id] = data;
      if (data.nombre) {
        conceptosCache[data.nombre.toLowerCase().trim()] = data;
      }
    });
  } catch (error) {
    console.error("Error cargando cuotas_config:", error);
  }
}

async function cargarPagosYCalcularVencimientos(orgId) {
  const tbody = document.getElementById("tablaComunicacionesBody");
  if (!tbody) return;

  try {
    const q = query(collection(db, "pagos"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Objeto temporal para agrupar por socio y quedarnos solo con su pago más reciente
    const ultimosPagosPorSocio = {};

    snap.forEach(docSnap => {
      const pago = docSnap.data();
      const socioIdKey = pago.socioId || pago.socioNombre || "desconocido";

      let configCuota = null;
      if (pago.cuotaId && conceptosCache[pago.cuotaId]) {
        configCuota = conceptosCache[pago.cuotaId];
      } else if (pago.nombreCuota && conceptosCache[pago.nombreCuota.toLowerCase().trim()]) {
        configCuota = conceptosCache[pago.nombreCuota.toLowerCase().trim()];
      }

      const periodicidad = configCuota ? parseInt(configCuota.periodicidad, 10) : (parseInt(pago.periodicidad, 10) || 0);
      const tipoUnidad = configCuota ? (configCuota.tipoUnidad || 'meses') : (pago.tipoUnidad || 'meses');

      const proximoCobroFecha = calcularSiguienteFecha(pago.fechaPago, periodicidad, tipoUnidad);
      
      // Comparamos por fecha de pago o próximo cobro para saber cuál es el más reciente
      const timestampActual = new Date(pago.fechaPago || "1970-01-01").getTime();

      if (!ultimosPagosPorSocio[socioIdKey] || timestampActual > ultimosPagosPorSocio[socioIdKey].timestamp) {
        ultimosPagosPorSocio[socioIdKey] = {
          id: docSnap.id,
          pagoData: pago,
          timestamp: timestampActual,
          proximoCobroFecha: proximoCobroFecha
        };
      }
    });

    pagosConCalculoCache = [];

    // Procesamos el pago más reciente de cada socio
    Object.values(ultimosPagosPorSocio).forEach(item => {
      const pago = item.pagoData;
      const proximoCobroFecha = item.proximoCobroFecha;
      const diferenciaDias = calcularDiferenciaDias(proximoCobroFecha, hoy);

      const esValidoPorFecha = (proximoCobroFecha.includes("Pago único") || proximoCobroFecha.includes("inválida")) || (diferenciaDias <= 40);

      if (esValidoPorFecha) {
        const estadoVencimiento = evaluarEstadoVencimientoConDias(diferenciaDias, proximoCobroFecha);

        let correoActual = pago.socioEmail || pago.email || "correo@ejemplo.com";
        if (pago.socioId && sociosCache[pago.socioId]) {
          correoActual = sociosCache[pago.socioId].correo || correoActual;
        }

        const notifEnviada = pago.notificacionEnviada || false;
        const estadoNotif = notifEnviada 
          ? { texto: "Enviado", style: "background-color: #d1fae5; color: #065f46;" }
          : { texto: "Pendiente", style: "background-color: #f3f4f6; color: #4b5563;" };

        pagosConCalculoCache.push({
          id: item.id,
          socioNombre: pago.socioNombre || "Socio desconocido",
          socioEmail: correoActual,
          nombreCuota: pago.nombreCuota || "Cuota general",
          fechaPago: pago.fechaPago || "-",
          proximoCobro: proximoCobroFecha,
          estado: estadoVencimiento,
          estadoNotificacion: estadoNotif
        });
      }
    });

    renderizarTablaComunicaciones();

  } catch (error) {
    console.error("Error al cargar los pagos:", error);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger);">Error al cargar los datos de cobros.</td></tr>`;
  }
}

function calcularDiferenciaDias(fechaStr, hoy) {
  if (!fechaStr || fechaStr.includes("Pago único") || fechaStr.includes("inválida")) {
    return 9999;
  }
  const partes = fechaStr.split('-');
  const fechaVenc = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
  return Math.ceil((fechaVenc - hoy) / (1000 * 60 * 60 * 24));
}

function calcularSiguienteFecha(fechaPagoStr, periodicidad, tipoUnidad) {
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

  const anioRes = fecha.getFullYear();
  const mesRes = String(fecha.getMonth() + 1).padStart(2, '0');
  const diaRes = String(fecha.getDate()).padStart(2, '0');

  return `${anioRes}-${mesRes}-${diaRes}`;
}

function evaluarEstadoVencimientoConDias(diferenciaDias, fechaStr) {
  if (!fechaStr || fechaStr.includes("Pago único") || fechaStr.includes("inválida")) {
    return { texto: "Inactivo / Único", style: "background-color: #f3f4f6; color: #4b5563;" };
  }

  if (diferenciaDias < 0) {
    // La fecha ya pasó (atrasado)
    return { texto: "Atrasado", style: "background-color: #fee2e2; color: #991b1b;" };
  } else if (diferenciaDias === 0) {
    // Es exactamente hoy
    return { texto: "Vence hoy", style: "background-color: #fef3c7; color: #92400e;" }; // Puedes cambiar el color si prefieres rojo o ámbar
  } else if (diferenciaDias <= 5) {
    return { texto: `Próximo (${diferenciaDias} días)`, style: "background-color: #fef3c7; color: #92400e;" };
  } else {
    return { texto: "Al día", style: "background-color: #d1fae5; color: #065f46;" };
  }
}

function renderizarTablaComunicaciones() {
  const tbody = document.getElementById("tablaComunicacionesBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (pagosConCalculoCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No hay registros de pagos dentro del margen establecido.</td></tr>`;
    return;
  }

  pagosConCalculoCache.forEach((item) => {
    tbody.innerHTML += `
      <tr>
        <td>
          <strong>${item.socioNombre}</strong><br>
          <small style="color: var(--text-muted);">${item.socioEmail}</small>
        </td>
        <td>${item.nombreCuota}</td>
        <td>${item.fechaPago}</td>
        <td><strong>${item.proximoCobro}</strong></td>
        <td><span class="badge-status" style="${item.estado.style || ''}">${item.estado.texto}</span></td>
        <td><span class="badge-status" style="${item.estadoNotificacion.style || ''}">${item.estadoNotificacion.texto}</span></td>
        <td style="text-align: right;">
          <button type="button" class="btn-secondary btn-enviar-correo" data-id="${item.id}" data-email="${item.socioEmail}" data-nombre="${item.socioNombre}" data-cuota="${item.nombreCuota}" data-fecha="${item.proximoCobro}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
            Mandar Correo
          </button>
        </td>
      </tr>
    `;
  });

  document.querySelectorAll(".btn-enviar-correo").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const pagoId = e.currentTarget.getAttribute("data-id");
      const email = e.currentTarget.getAttribute("data-email");
      const nombre = e.currentTarget.getAttribute("data-nombre");
      const cuota = e.currentTarget.getAttribute("data-cuota");
      const fecha = e.currentTarget.getAttribute("data-fecha");
      
      abrirModalCorreo(pagoId, email, nombre, cuota, fecha);
    });
  });
}

function inicializarEventosModal() {
  const btnMasivo = document.getElementById("btnEnviarMasivo");

  if (btnMasivo) {
    btnMasivo.addEventListener("click", () => {
      const totalPendientes = pagosConCalculoCache.length;
      if (totalPendientes === 0) {
        mostrarModalExito("No hay avisos pendientes para enviar.", "warning");
        return;
      }
      mostrarModalExito(`Se ha simulado el envío masivo para un total de ${totalPendientes} socios.`, "info");
    });
  }
}

function abrirModalCorreo(pagoId, email, nombre, cuota, fecha) {
  const modalAnterior = document.getElementById("modalPopupFlexiaConfirm");
  if (modalAnterior) modalAnterior.remove();

  const cuerpo = `Hola ${nombre},\n\nTe recordamos que tu próximo cobro del concepto "${cuota}" está programado para la fecha ${fecha}.\n\nUn saludo cordial.`;
  const asuntoCorreo = "Aviso de próximo cobro de cuota";

  const overlay = document.createElement("div");
  overlay.id = "modalPopupFlexiaConfirm";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(2px);
    font-family: inherit;
  `;

  const caja = document.createElement("div");
  caja.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 14px;
    max-width: 420px;
    width: 90%;
    text-align: center;
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.2);
  `;

  caja.innerHTML = `
    <div style="margin: 0 auto 15px auto; width: 50px; height: 50px; border-radius: 50%; background-color: #dbeafe; color: #1e40af; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: bold;">
      i
    </div>
    <h3 style="margin: 0 0 10px 0; font-size: 1.25rem; color: #111827;">Enviar Notificación de Cobro</h3>
    <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 0.95rem; line-height: 1.5;">
      Se enviará un correo electrónico de recordatorio a <strong>${email}</strong>.
    </p>
    
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 12px 16px; border-radius: 8px; font-size: 0.9rem; text-align: left; margin-bottom: 25px;">
      <div style="font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; opacity: 0.8;">Asunto del correo:</div>
      <div style="font-weight: 500;">${asuntoCorreo}</div>
    </div>

    <div style="display: flex; gap: 10px;">
      <button id="btnCancelarPopupFlexia" style="flex: 1; background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 10px 20px; border-radius: 8px; font-size: 0.95rem; cursor: pointer; font-weight: 500;">
        Cancelar
      </button>
      <button id="btnAceptarPopupFlexia" style="flex: 1; background-color: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 0.95rem; cursor: pointer; font-weight: 500;">
        Enviar Correo
      </button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();

  document.getElementById("btnCancelarPopupFlexia").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  document.getElementById("btnAceptarPopupFlexia").addEventListener("click", async () => {
    const btnAceptar = document.getElementById("btnAceptarPopupFlexia");
    const textoOriginal = btnAceptar.innerHTML;
    
    try {
      btnAceptar.disabled = true;
      btnAceptar.innerHTML = "Enviando...";

      const templateParams = {
        to_email: email,
        to_name: nombre,
        nombre_cuota: cuota,
        fecha_cobro: fecha,
        message: cuerpo
      };

      await emailjs.send("service_3j0etjq", "template_17r9k9m", templateParams, "4OhnOqhXx8ZCQsXXg");

      if (pagoId) {
        const pagoRef = doc(db, "pagos", pagoId);
        await updateDoc(pagoRef, { notificacionEnviada: true });
      }

      cerrar();
      mostrarModalExito(`¡Correo enviado con éxito a ${email}!`, "success");
      await cargarPagosYCalcularVencimientos(currentUserOrgId);

    } catch (error) {
      console.error("Error al enviar el correo con EmailJS:", error);
      mostrarModalExito("Hubo un error al enviar el correo. Revisa la consola.", "error");
      btnAceptar.disabled = false;
      btnAceptar.innerHTML = textoOriginal;
    }
  });
}

function mostrarModalExito(mensaje, tipo = "success") {
  const modalAnterior = document.getElementById("modalPopupFlexia");
  if (modalAnterior) modalAnterior.remove();

  const coloresIcono = {
    success: { bg: "#d1fae5", color: "#065f46", symbol: "✓" },
    error: { bg: "#fee2e2", color: "#991b1b", symbol: "✕" },
    warning: { bg: "#fef3c7", color: "#92400e", symbol: "!" },
    info: { bg: "#dbeafe", color: "#1e40af", symbol: "i" }
  };

  const config = coloresIcono[tipo] || coloresIcono.success;

  const overlay = document.createElement("div");
  overlay.id = "modalPopupFlexia";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(2px);
    font-family: inherit;
  `;

  const caja = document.createElement("div");
  caja.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 14px;
    max-width: 380px;
    width: 90%;
    text-align: center;
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.2);
  `;

  caja.innerHTML = `
    <div style="margin: 0 auto 15px auto; width: 50px; height: 50px; border-radius: 50%; background-color: ${config.bg}; color: ${config.color}; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: bold;">
      ${config.symbol}
    </div>
    <h3 style="margin: 0 0 10px 0; font-size: 1.25rem; color: #111827;">${tipo === 'success' ? '¡Enviado!' : 'Aviso'}</h3>
    <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 0.95rem; line-height: 1.5;">${mensaje}</p>
    <button id="btnCerrarPopupFlexia" style="background-color: #1e1b4b; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 0.95rem; cursor: pointer; width: 100%; font-weight: 500;">
      Aceptar
    </button>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  document.getElementById("btnCerrarPopupFlexia").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
}