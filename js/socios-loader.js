import { db, auth } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserOrgId = null;
let sociosGlobalCache = []; 

let paginaActualSocios = 1;
const FILAS_POR_PAGINA = 10;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      currentUserOrgId = userData.organizationId || userData.orgId || userData.companyId;

      if (!currentUserOrgId) {
        mostrarMensajeTabla("El usuario no está vinculado a ninguna organización.");
        return;
      }

      await cargarSociosDeOrg(currentUserOrgId);
      await cargarSelectCuotasConfig(currentUserOrgId);
      inicializarBuscadorSocios();
      inicializarImportadorYPlantillaExcel();

    } catch (error) {
      console.error("Error al obtener la organización:", error);
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const btnPrev = document.getElementById("btnPrevPage");
  const btnNext = document.getElementById("btnNextPage");

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (paginaActualSocios > 1) {
        paginaActualSocios--;
        renderizarTablaSociosConPaginacion();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      const totalPaginas = Math.ceil(sociosGlobalCache.length / FILAS_POR_PAGINA) || 1;
      if (paginaActualSocios < totalPaginas) {
        paginaActualSocios++;
        renderizarTablaSociosConPaginacion();
      }
    });
  }
});

function separarNombreYApellidos(nombreCompleto) {
  const partes = (nombreCompleto || "").trim().split(/\s+/);
  if (partes.length === 0) return { nombre: "", apellidos: "" };
  if (partes.length === 1) return { nombre: partes[0], apellidos: "" };
  if (partes.length === 2) return { nombre: partes[0], apellidos: partes[1] };
  
  const nombre = partes[0];
  const apellidos = partes.slice(1).join(" ");
  return { nombre, apellidos };
}

async function registrarLog(comentario) {
  try {
    const user = auth.currentUser;
    const correo = user && user.email ? user.email : "Desconocido";

    await addDoc(collection(db, "logs"), {
      comentario: comentario,
      correo: correo,
      fecha: serverTimestamp(),
      organizationId: currentUserOrgId || null
    });
  } catch (error) {
    console.error("Error al registrar el log:", error);
  }
}

function mostrarModalExito(titulo, texto, callbackCierre = null) {
  let modalExito = document.getElementById("modalAlertaExitoGlobal");
  
  if (!modalExito) {
    modalExito = document.createElement("div");
    modalExito.id = "modalAlertaExitoGlobal";
    modalExito.className = "modal-overlay";
    modalExito.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalExito);
  }

  modalExito.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 400px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.25rem 1.5rem;">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a);">${titulo}</h3>
      <p style="font-size: 0.925rem; color: var(--text-secondary, #475569); margin-bottom: 0; line-height: 1.5;">${texto}</p>
    </div>
  `;

  modalExito.style.display = "flex";

  setTimeout(() => {
    modalExito.style.display = "none";
    if (callbackCierre) callbackCierre();
  }, 1500);
}

function mostrarModalError(titulo, texto) {
  let modalError = document.getElementById("modalAlertaErrorGlobal");
  
  if (!modalError) {
    modalError = document.createElement("div");
    modalError.id = "modalAlertaErrorGlobal";
    modalError.className = "modal-overlay";
    modalError.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalError);
  }

  modalError.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 400px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2.25rem 1.5rem;">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #fee2e2; color: var(--danger, #ef4444); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a);">${titulo}</h3>
      <p style="font-size: 0.925rem; color: var(--text-secondary, #475569); margin-bottom: 1.5rem; line-height: 1.5;">${texto}</p>
      <button type="button" id="btnCerrarModalErrorGlobal" class="btn-secondary" style="width: 100%;">Entendido</button>
    </div>
  `;

  modalError.style.display = "flex";
  
  const btnCerrar = document.getElementById("btnCerrarModalErrorGlobal");
  btnCerrar.onclick = () => {
    modalError.style.display = "none";
  };
}

async function cargarSociosDeOrg(orgId) {
  try {
    const q = query(collection(db, "socios"), where("organizationId", "==", orgId));
    const querySnapshot = await getDocs(q);
    
    sociosGlobalCache = [];
    querySnapshot.forEach((docSnap) => {
      sociosGlobalCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    sociosGlobalCache.sort((a, b) => {
      const nombreA = (a.nombre || "").toLowerCase();
      const nombreB = (b.nombre || "").toLowerCase();
      return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
    });

    paginaActualSocios = 1;
    renderizarTablaSociosConPaginacion();

  } catch (error) {
    console.error("Error al cargar los socios:", error);
    mostrarMensajeTabla("Error al cargar los datos.");
  }
}

function renderizarTablaSociosConPaginacion() {
  const tableBody = document.getElementById("sociosTableBody");
  const paginationInfo = document.getElementById("paginationInfo");
  const btnPrev = document.getElementById("btnPrevPage");
  const btnNext = document.getElementById("btnNextPage");

  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (sociosGlobalCache.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No se encontraron socios.</td></tr>`;
    if (paginationInfo) paginationInfo.textContent = "Mostrando 0 de 0 socios";
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const listaOrdenada = [...sociosGlobalCache].sort((a, b) => {
    const nombreA = (a.nombre || "").toLowerCase();
    const nombreB = (b.nombre || "").toLowerCase();
    return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
  });

  const totalRegistros = listaOrdenada.length;
  const totalPaginas = Math.ceil(totalRegistros / FILAS_POR_PAGINA) || 1;

  if (paginaActualSocios > totalPaginas) paginaActualSocios = totalPaginas;
  if (paginaActualSocios < 1) paginaActualSocios = 1;

  const inicio = (paginaActualSocios - 1) * FILAS_POR_PAGINA;
  const fin = inicio + FILAS_POR_PAGINA;
  const sociosPagina = listaOrdenada.slice(inicio, fin);

  sociosPagina.forEach((socio) => {
    const socioId = socio.id;
    const nombre = socio.nombre || "Sin nombre";
    const dni = socio.dni || "Sin DNI";
    const correo = socio.correo || "Sin correo";
    const telefono = socio.telefono || "No disponible";
    const fechaAlta = socio.fechaAlta || "No especificada";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${nombre}</strong></td>
      <td>${dni}</td>
      <td>${correo}</td>
      <td>${telefono}</td>
      <td>${fechaAlta}</td>
      <td style="text-align: right;">
        <button class="btn-secondary btn-ver-perfil" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Ver Perfil</button>
      </td>
    `;
    
    tr.querySelector(".btn-ver-perfil").addEventListener("click", () => {
      abrirPerfilSocio(socioId, socio);
    });

    tableBody.appendChild(tr);
  });

  if (paginationInfo) {
    const mostrandoHasta = Math.min(fin, totalRegistros);
    paginationInfo.textContent = `Mostrando ${inicio + 1}-${mostrandoHasta} de ${totalRegistros} socios (Página ${paginaActualSocios} de ${totalPaginas})`;
  }

  if (btnPrev) btnPrev.disabled = paginaActualSocios <= 1;
  if (btnNext) btnNext.disabled = paginaActualSocios >= totalPaginas;
}

function inicializarBuscadorSocios() {
  const inputFiltro = document.getElementById("filtroSociosGeneral");

  if (inputFiltro) {
    inputFiltro.addEventListener("input", (e) => {
      const texto = e.target.value.toLowerCase().trim();

      const sociosFiltrados = sociosGlobalCache.filter(socio => {
        const nombre = (socio.nombre || "").toLowerCase();
        const dni = (socio.dni || "").toLowerCase();

        return nombre.includes(texto) || dni.includes(texto);
      });

      paginaActualSocios = 1;
      renderizarTablaSociosConFiltro(sociosFiltrados);
    });
  }
}

function renderizarTablaSociosConFiltro(listaFiltrada) {
  const tableBody = document.getElementById("sociosTableBody");
  const paginationInfo = document.getElementById("paginationInfo");
  const btnPrev = document.getElementById("btnPrevPage");
  const btnNext = document.getElementById("btnNextPage");

  if (!tableBody) return;

  tableBody.innerHTML = "";

  if (listaFiltrada.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No se encontraron socios.</td></tr>`;
    if (paginationInfo) paginationInfo.textContent = "Mostrando 0 de 0 socios";
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const totalRegistros = listaFiltrada.length;
  const totalPaginas = Math.ceil(totalRegistros / FILAS_POR_PAGINA) || 1;

  if (paginaActualSocios > totalPaginas) paginaActualSocios = totalPaginas;
  if (paginaActualSocios < 1) paginaActualSocios = 1;

  const inicio = (paginaActualSocios - 1) * FILAS_POR_PAGINA;
  const fin = inicio + FILAS_POR_PAGINA;
  const sociosPagina = listaFiltrada.slice(inicio, fin);

  sociosPagina.forEach((socio) => {
    const socioId = socio.id;
    const nombre = socio.nombre || "Sin nombre";
    const dni = socio.dni || "Sin DNI";
    const correo = socio.correo || "Sin correo";
    const telefono = socio.telefono || "No disponible";
    const fechaAlta = socio.fechaAlta || "No especificada";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${nombre}</strong></td>
      <td>${dni}</td>
      <td>${correo}</td>
      <td>${telefono}</td>
      <td>${fechaAlta}</td>
      <td style="text-align: right;">
        <button class="btn-secondary btn-ver-perfil" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Ver Perfil</button>
      </td>
    `;
    
    tr.querySelector(".btn-ver-perfil").addEventListener("click", () => {
      abrirPerfilSocio(socioId, socio);
    });

    tableBody.appendChild(tr);
  });

  if (paginationInfo) {
    const mostrandoHasta = Math.min(fin, totalRegistros);
    paginationInfo.textContent = `Mostrando ${inicio + 1}-${mostrandoHasta} de ${totalRegistros} socios (Página ${paginaActualSocios} de ${totalPaginas})`;
  }

  if (btnPrev) btnPrev.disabled = paginaActualSocios <= 1;
  if (btnNext) btnNext.disabled = paginaActualSocios >= totalPaginas;
}

function inicializarImportadorYPlantillaExcel() {
  let contenedorBusqueda = document.getElementById("filtroSociosGeneral")?.parentNode;
  
  let btnSubirExcel = document.getElementById("btnSubirExcel");
  let inputExcelFile = document.getElementById("inputExcelFile");
  let btnPlantillaExcel = document.getElementById("btnPlantillaExcel");

  if (!btnSubirExcel && contenedorBusqueda) {
    btnSubirExcel = document.createElement("button");
    btnSubirExcel.id = "btnSubirExcel";
    btnSubirExcel.className = "btn-secondary";
    btnSubirExcel.style.cssText = "background-color: var(--accent-light, #e0f2fe); color: var(--accent-primary, #0284c7);";
    btnSubirExcel.textContent = "Subir Excel";
    
    inputExcelFile = document.createElement("input");
    inputExcelFile.id = "inputExcelFile";
    inputExcelFile.type = "file";
    inputExcelFile.accept = ".xlsx, .xls";
    inputExcelFile.style.display = "none";

    contenedorBusqueda.insertBefore(inputExcelFile, contenedorBusqueda.firstChild);
    contenedorBusqueda.insertBefore(btnSubirExcel, inputExcelFile);
  }

  if (!btnPlantillaExcel && contenedorBusqueda) {
    btnPlantillaExcel = document.createElement("button");
    btnPlantillaExcel.id = "btnPlantillaExcel";
    btnPlantillaExcel.className = "btn-secondary";
    btnPlantillaExcel.style.cssText = "background-color: var(--accent-light, #e0f2fe); color: var(--accent-primary, #0284c7);";
    btnPlantillaExcel.textContent = "Plantilla Excel";
    contenedorBusqueda.appendChild(btnPlantillaExcel);
  }

  if (btnPlantillaExcel) {
    const nuevoBtnPlantilla = btnPlantillaExcel.cloneNode(true);
    btnPlantillaExcel.parentNode.replaceChild(nuevoBtnPlantilla, btnPlantillaExcel);

    nuevoBtnPlantilla.addEventListener("click", () => {
      abrirModalPlantillaExcel();
    });
  }

  if (btnSubirExcel && inputExcelFile) {
    const nuevoBtnSubir = btnSubirExcel.cloneNode(true);
    btnSubirExcel.parentNode.replaceChild(nuevoBtnSubir, btnSubirExcel);

    nuevoBtnSubir.addEventListener("click", () => {
      inputExcelFile.click();
    });

    inputExcelFile.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      if (typeof XLSX === 'undefined') {
        mostrarModalError("Error", "La librería de lectura de Excel (SheetJS) no está cargada en el HTML.");
        inputExcelFile.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          let headerIndex = -1;
          let colsMap = {};

          for (let i = 0; i < rows.length; i++) {
            const rowStr = rows[i].map(cell => String(cell).trim().toLowerCase());
            if (rowStr.some(c => c.includes('nombre')) && rowStr.some(c => c.includes('d.n.i.') || c.includes('dni'))) {
              headerIndex = i;
              rows[i].forEach((colName, colIdx) => {
                const name = String(colName).trim().toLowerCase();
                if (name.includes('nombre')) colsMap.nombre = colIdx;
                if (name.includes('sexo')) colsMap.sexo = colIdx;
                if (name.includes('dirección') || name.includes('direccion')) colsMap.direccion = colIdx;
                if (name.includes('localidad')) colsMap.localidad = colIdx;
                if (name.includes('provincia')) colsMap.provincia = colIdx;
                if (name.includes('nacimiento')) colsMap.nacimiento = colIdx;
                if (name.includes('d.n.i.') || name.includes('dni')) colsMap.dni = colIdx;
                if (name.includes('teléfono') || name.includes('telefono')) colsMap.telefono = colIdx;
                if (name.includes('correo')) colsMap.correo = colIdx;
                if (name.includes('fecha de alta')) colsMap.fechaAlta = colIdx;
              });
              break;
            }
          }

          if (headerIndex === -1) {
            mostrarModalError("Formato incorrecto", "No se encontró una cabecera válida en el archivo Excel.");
            inputExcelFile.value = '';
            return;
          }

          let importadosCount = 0;
          const batch = writeBatch(db);
          let batchCount = 0;

          const parseFechaExcel = (val) => {
            if (!val) return '';
            if (typeof val === 'number') {
              const dateObj = XLSX.SSF.parse_date_code(val);
              if (dateObj) {
                const y = dateObj.y;
                const m = String(dateObj.m).padStart(2, '0');
                const d = String(dateObj.d).padStart(2, '0');
                return `${y}-${m}-${d}`;
              }
            }
            const valStr = String(val).trim();
            if (valStr.includes('/')) {
              const partes = valStr.split('/');
              if (partes.length === 3) {
                let year = partes[2];
                if (year.length === 2) year = '20' + year;
                return `${year}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
              }
            }
            return valStr;
          };

          for (let i = headerIndex + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const getVal = (idx) => (idx !== undefined && row[idx] !== undefined ? row[idx] : '');

            const nombre = String(getVal(colsMap.nombre)).trim();
            if (!nombre) continue;

            const nuevoSocioData = {
              nombre: nombre,
              sexo: String(getVal(colsMap.sexo)).trim() || "Hombre",
              direccion: String(getVal(colsMap.direccion)).trim(),
              localidad: String(getVal(colsMap.localidad)).trim(),
              provincia: String(getVal(colsMap.provincia)).trim(),
              nacimiento: parseFechaExcel(getVal(colsMap.nacimiento)),
              dni: String(getVal(colsMap.dni)).trim(),
              telefono: String(getVal(colsMap.telefono)).trim(),
              correo: String(getVal(colsMap.correo)).trim(),
              fechaAlta: parseFechaExcel(getVal(colsMap.fechaAlta)),
              organizationId: currentUserOrgId,
              createdAt: new Date()
            };

            const newDocRef = doc(collection(db, "socios"));
            batch.set(newDocRef, nuevoSocioData);
            importadosCount++;
            batchCount++;

            if (batchCount >= 450) {
              await batch.commit();
              batchCount = 0;
            }
          }

          if (batchCount > 0) {
            await batch.commit();
          }

          await registrarLog(`SOCIOS: Importación masiva de ${importadosCount} socios desde archivo Excel.`);

          inputExcelFile.value = '';
          mostrarModalExito("¡Importación exitosa!", `Se han importado ${importadosCount} socios correctamente desde el Excel.`, async () => {
            await cargarSociosDeOrg(currentUserOrgId);
          });

        } catch (error) {
          console.error("Error al procesar el archivo Excel:", error);
          mostrarModalError("Error", "Hubo un error al leer y procesar el archivo Excel.");
          inputExcelFile.value = '';
        }
      };

      reader.readAsArrayBuffer(file);
    });
  }
}

function abrirModalPlantillaExcel() {
  let modalPlantilla = document.getElementById("modalDescargaPlantillaExcel");

  if (!modalPlantilla) {
    modalPlantilla = document.createElement("div");
    modalPlantilla.id = "modalDescargaPlantillaExcel";
    modalPlantilla.className = "modal-overlay";
    modalPlantilla.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1300; align-items: center; justify-content: center; padding: 1rem;";
    document.body.appendChild(modalPlantilla);
  }

  modalPlantilla.innerHTML = `
    <div class="content-card" style="width: 100%; max-width: 480px; margin: auto; animation: fadeIn 0.2s ease; padding: 2.25rem 1.75rem;">
      <div style="width: 52px; height: 52px; border-radius: 50%; background: #e0f2fe; color: var(--accent-primary, #0284c7); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </div>
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600; color: var(--text-main, #0f172a); text-align: center;">Plantilla de subida masiva</h3>
      <p style="font-size: 0.9rem; color: var(--text-secondary, #475569); margin-bottom: 1.25rem; line-height: 1.5; text-align: center;">
        Se descargará un archivo Excel de ejemplo. Para que la importación funcione correctamente, las columnas deben mantenerse estrictamente en el siguiente orden:
      </p>
      
      <div style="background: var(--bg-main, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 1.5rem; font-size: 0.825rem; color: var(--text-main, #0f172a);">
        <ol style="margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.3rem;">
          <li><strong>Nombre</strong></li>
          <li><strong>Sexo</strong> (Hombre / Mujer)</li>
          <li><strong>Dirección</strong></li>
          <li><strong>Localidad</strong></li>
          <li><strong>Provincia</strong></li>
          <li><strong>Nacimiento</strong> (AAAA-MM-DD o formato fecha)</li>
          <li><strong>D.N.I.</strong></li>
          <li><strong>Teléfono</strong></li>
          <li><strong>Correo</strong></li>
          <li><strong>Fecha de alta</strong> (AAAA-MM-DD o formato fecha)</li>
        </ol>
      </div>

      <div style="display: flex; gap: 0.75rem;">
        <button type="button" id="btnCerrarModalPlantilla" class="btn-secondary" style="flex: 1;">Cancelar</button>
        <button type="button" id="btnConfirmarDescargaPlantilla" class="btn-secondary" style="flex: 1; background-color: var(--accent-primary, #0284c7); color: #fff; border-color: var(--accent-primary, #0284c7);">Descargar Plantilla</button>
      </div>
    </div>
  `;

  modalPlantilla.style.display = "flex";

  const btnCerrar = document.getElementById("btnCerrarModalPlantilla");
  const btnConfirmar = document.getElementById("btnConfirmarDescargaPlantilla");

  btnCerrar.onclick = () => {
    modalPlantilla.style.display = "none";
  };

  btnConfirmar.onclick = () => {
    modalPlantilla.style.display = "none";
    generarYDescargarPlantillaExcel();
  };
}

function generarYDescargarPlantillaExcel() {
  if (typeof XLSX === 'undefined') {
    mostrarModalError("Error", "La librería SheetJS no está disponible para generar la plantilla.");
    return;
  }

  const cabeceras = [
    "Nombre", 
    "Sexo",
    "Dirección", 
    "Localidad", 
    "Provincia", 
    "Nacimiento", 
    "D.N.I.", 
    "Teléfono", 
    "Correo", 
    "Fecha de alta"
  ];

  const ejemploFila = [
    "Juan Pérez García",
    "Hombre",
    "Calle Mayor 12",
    "Madrid",
    "Madrid",
    "1990-05-15",
    "12345678X",
    "600123456",
    "juan.perez@example.com",
    "2026-01-10"
  ];

  const worksheetData = [cabeceras, ejemploFila];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Plantilla Socios");

  XLSX.writeFile(workbook, "plantilla_importacion_socios.xlsx");
}

function mostrarMensajeTabla(mensaje) {
  const tableBody = document.getElementById("sociosTableBody");
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">${mensaje}</td></tr>`;
  }
}

async function cargarSelectCuotasConfig(orgId) {
  const select = document.getElementById("selectCuotaConfig");
  if (!select) return;

  try {
    const q = query(collection(db, "cuotas_config"), where("organizationId", "==", orgId));
    const snap = await getDocs(q);

    select.innerHTML = '<option value="">Seleccionar concepto de cuota...</option>';
    snap.forEach((docSnap) => {
      const config = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.dataset.nombre = config.nombre;
      option.dataset.importe = config.importe;
      option.textContent = `${config.nombre} (${config.importe}€)`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Error al cargar conceptos de cuota para el select:", error);
  }
}

async function abrirPerfilSocio(socioId, socio) {
  salirModoEdicionPerfil();

  document.getElementById("perfilNombre").textContent = socio.nombre || "No especificado";
  document.getElementById("perfilSexo").textContent = socio.sexo || "No especificado";
  document.getElementById("perfilDireccion").textContent = socio.direccion || "No especificada";
  document.getElementById("perfilLocalidad").textContent = socio.localidad || "No especificada";
  document.getElementById("perfilProvincia").textContent = socio.provincia || "No especificada";
  document.getElementById("perfilNacimiento").textContent = socio.nacimiento || "No especificada";
  document.getElementById("perfilDni").textContent = socio.dni || "No especificado";
  document.getElementById("perfilTelefono").textContent = socio.telefono || "No especificado";
  document.getElementById("perfilCorreo").textContent = socio.correo || "No especificado";
  document.getElementById("perfilFechaAlta").textContent = socio.fechaAlta || "No especificada";

  let esFederadoActual = false;
  try {
    const qFed = query(
      collection(db, "federacion"),
      where("organizationId", "==", currentUserOrgId),
      where("dni", "==", socio.dni || "")
    );
    const snapFed = await getDocs(qFed);
    if (!snapFed.empty) {
      esFederadoActual = true;
    }
  } catch (e) {
    console.error("Error al comprobar federación:", e);
  }

  document.getElementById("perfilFederado").textContent = esFederadoActual ? "Sí" : "No";
  document.getElementById("editFederado").value = esFederadoActual ? "si" : "no";

  document.getElementById("editNombre").value = socio.nombre || "";
  document.getElementById("editSexo").value = socio.sexo || "Hombre";
  document.getElementById("editDireccion").value = socio.direccion || "";
  document.getElementById("editLocalidad").value = socio.localidad || "";
  document.getElementById("editProvincia").value = socio.provincia || "";
  document.getElementById("editNacimiento").value = socio.nacimiento || "";
  document.getElementById("editDni").value = socio.dni || "";
  document.getElementById("editTelefono").value = socio.telefono || "";
  document.getElementById("editCorreo").value = socio.correo || "";
  document.getElementById("editFechaAlta").value = socio.fechaAlta || "";

  const lblFrecuencia = document.getElementById("perfilFrecuencia");
  lblFrecuencia.textContent = "Cargando último pago...";

  let arrayPagosGlobal = [];

  try {
    const qPagos = query(
        collection(db, "pagos"), 
        where("socioId", "==", socioId),
        where("organizationId", "==", currentUserOrgId)
      );
    const pagosSnapshot = await getDocs(qPagos);
    
    if (pagosSnapshot.empty) {
      lblFrecuencia.textContent = "Sin pagos registrados";
    } else {
      pagosSnapshot.forEach((docPago) => {
        arrayPagosGlobal.push({ id: docPago.id, ...docPago.data() });
      });

      arrayPagosGlobal.sort((a, b) => new Date(b.fechaPago) - new Date(a.fechaPago));
      const ultimoPago = arrayPagosGlobal[0];

      lblFrecuencia.textContent = `${ultimoPago.fechaPago} — ${ultimoPago.nombreCuota} (${ultimoPago.monto}€)`;
    }
  } catch (err) {
    console.error("Error al cargar pagos del socio:", err);
    lblFrecuencia.textContent = "Error al obtener pagos";
  }

  const btnEditSocio = document.getElementById("btn-edit-socio");
  const btnDeleteSocio = document.getElementById("btn-delete-socio");

  let btnDownloadSocio = document.getElementById("btn-download-socio");
  if (!btnDownloadSocio && btnEditSocio && btnEditSocio.parentNode) {
    btnDownloadSocio = document.createElement("button");
    btnDownloadSocio.id = "btn-download-socio";
    btnDownloadSocio.className = "btn-icon-action";
    btnDownloadSocio.title = "Descargar datos";
    btnDownloadSocio.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;
    btnEditSocio.parentNode.insertBefore(btnDownloadSocio, btnDeleteSocio);
  }

  const nuevoBtnEdit = btnEditSocio.cloneNode(true);
  btnEditSocio.parentNode.replaceChild(nuevoBtnEdit, btnEditSocio);

  const nuevoBtnDelete = btnDeleteSocio.cloneNode(true);
  btnDeleteSocio.parentNode.replaceChild(nuevoBtnDelete, btnDeleteSocio);

  const nuevoBtnDownload = btnDownloadSocio.cloneNode(true);
  btnDownloadSocio.parentNode.replaceChild(nuevoBtnDownload, btnDownloadSocio);

  nuevoBtnEdit.addEventListener("click", () => {
    entrarModoEdicionPerfil();
  });

  nuevoBtnDownload.addEventListener("click", () => {
    try {
      let csvContent = "\uFEFF"; 
      
      csvContent += "=== DATOS DEL PERFIL ===\n";
      csvContent += "Campo;Valor\n";
      csvContent += `Nombre; "${(socio.nombre || "").replace(/"/g, '""')}"\n`;
      csvContent += `Sexo; "${(socio.sexo || "").replace(/"/g, '""')}"\n`;
      csvContent += `DNI; "${(socio.dni || "").replace(/"/g, '""')}"\n`;
      csvContent += `Correo; "${(socio.correo || "").replace(/"/g, '""')}"\n`;
      csvContent += `Teléfono; "${(socio.telefono || "").replace(/"/g, '""')}"\n`;
      csvContent += `Dirección; "${(socio.direccion || "").replace(/"/g, '""')}"\n`;
      csvContent += `Localidad; "${(socio.localidad || "").replace(/"/g, '""')}"\n`;
      csvContent += `Provincia; "${(socio.provincia || "").replace(/"/g, '""')}"\n`;
      csvContent += `Fecha de Nacimiento; "${(socio.nacimiento || "").replace(/"/g, '""')}"\n`;
      csvContent += `Fecha de Alta; "${(socio.fechaAlta || "").replace(/"/g, '""')}"\n`;
      
      csvContent += "\n";

      csvContent += "=== HISTORIAL DE PAGOS ===\n";
      csvContent += "Concepto de Cuota;Fecha de Pago;Importe\n";

      if (arrayPagosGlobal.length === 0) {
        csvContent += "Sin pagos registrados;-;-\n";
      } else {
        arrayPagosGlobal.forEach(pago => {
          const concepto = `"${(pago.nombreCuota || "Cuota").replace(/"/g, '""')}"`;
          const fecha = `"${(pago.fechaPago || "-")}"`;
          const monto = `"${(pago.monto !== undefined ? pago.monto + "€" : "")}"`;

          csvContent += [concepto, fecha, monto].join(";") + "\n";
        });
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      const dniLimpio = (socio.dni || "sindni").replace(/[^a-z0-9]/gi, '_');
      const fechaActual = new Date().toISOString().split('T')[0];
      
      link.download = `datos_${dniLimpio}_${fechaActual}.csv`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Error al exportar los datos:", error);
      mostrarModalError("Error", "Hubo un error al generar el archivo de descarga.");
    }
  });

  const btnCancelarEdicion = document.getElementById("btnCancelarEdicion");
  const nuevoBtnCancelarEdicion = btnCancelarEdicion.cloneNode(true);
  btnCancelarEdicion.parentNode.replaceChild(nuevoBtnCancelarEdicion, btnCancelarEdicion);
  nuevoBtnCancelarEdicion.addEventListener("click", () => {
    salirModoEdicionPerfil();
  });

  const btnGuardarEdicion = document.getElementById("btnGuardarEdicion");
  const nuevoBtnGuardarEdicion = btnGuardarEdicion.cloneNode(true);
  btnGuardarEdicion.parentNode.replaceChild(nuevoBtnGuardarEdicion, btnGuardarEdicion);
  
  nuevoBtnGuardarEdicion.addEventListener("click", async () => {
    const inputsEdit = document.querySelectorAll('#socioDetalleContainer .popup-input-edit');
    let formValido = true;

    for (const input of inputsEdit) {
      if (!input.checkValidity()) {
        input.reportValidity();
        formValido = false;
        break;
      }
    }

    if (!formValido) return;

    const telefonoInput = document.getElementById("editTelefono").value.trim();
    const nacimientoInput = document.getElementById("editNacimiento").value.trim();
    const altaInput = document.getElementById("editFechaAlta").value.trim();
    const federadoSelectVal = document.getElementById("editFederado").value;

    if (!/^\d+$/.test(telefonoInput)) {
      mostrarModalError("Dato inválido", "El teléfono debe contener únicamente números.");
      return;
    }

    const regexFechaCompleta = /^\d{4}-\d{2}-\d{2}$/;
    if (!regexFechaCompleta.test(nacimientoInput) || !regexFechaCompleta.test(altaInput)) {
      mostrarModalError("Fecha inválida", "Introduce una fecha completa válida (Año de 4 dígitos, mes y día).");
      return;
    }

    const datosActualizados = {
      nombre: document.getElementById("editNombre").value.trim(),
      sexo: document.getElementById("editSexo").value,
      direccion: document.getElementById("editDireccion").value.trim(),
      localidad: document.getElementById("editLocalidad").value.trim(),
      provincia: document.getElementById("editProvincia").value.trim(),
      nacimiento: nacimientoInput,
      dni: document.getElementById("editDni").value.trim(),
      telefono: telefonoInput,
      correo: document.getElementById("editCorreo").value.trim(),
      fechaAlta: altaInput
    };

    try {
      const socioRef = doc(db, "socios", socioId);
      await updateDoc(socioRef, datosActualizados);

      const qFedCheck = query(
        collection(db, "federacion"),
        where("organizationId", "==", currentUserOrgId),
        where("dni", "==", datosActualizados.dni)
      );
      const snapFedCheck = await getDocs(qFedCheck);

      const nombresSeparados = separarNombreYApellidos(datosActualizados.nombre);

      if (federadoSelectVal === "si") {
        if (snapFedCheck.empty) {
          await addDoc(collection(db, "federacion"), {
            nombre: nombresSeparados.nombre,
            apellidos: nombresSeparados.apellidos,
            nacimiento: datosActualizados.nacimiento,
            dni: datosActualizados.dni,
            organizationId: currentUserOrgId,
            createdAt: serverTimestamp()
          });
        } else {
          const fedDocRef = doc(db, "federacion", snapFedCheck.docs[0].id);
          await updateDoc(fedDocRef, {
            nombre: nombresSeparados.nombre,
            apellidos: nombresSeparados.apellidos,
            nacimiento: datosActualizados.nacimiento,
            dni: datosActualizados.dni
          });
        }
      }

      await registrarLog(`SOCIOS: Actualización de datos del socio: ${datosActualizados.nombre} (DNI: ${datosActualizados.dni})`);
      
      const index = sociosGlobalCache.findIndex(s => s.id === socioId);
      if (index !== -1) {
        sociosGlobalCache[index] = { ...sociosGlobalCache[index], ...datosActualizados };
      }
      
      sociosGlobalCache.sort((a, b) => (a.nombre || "").toLowerCase().localeCompare((b.nombre || "").toLowerCase(), 'es', { sensitivity: 'base' }));
      renderizarTablaSociosConPaginacion();
      
      mostrarModalExito("¡Actualizado con éxito!", "Los datos del socio han sido guardados correctamente.", () => {
        abrirPerfilSocio(socioId, sociosGlobalCache[index]);
      });
    } catch (error) {
      console.error("Error al actualizar el socio:", error);
      mostrarModalError("Error", "Hubo un error al actualizar los datos del socio.");
    }
  });

  nuevoBtnDelete.addEventListener("click", () => {
    mostrarModalConfirmacionBorrado(socio, arrayPagosGlobal, socioId);
  });

  const btnHistorico = document.getElementById("btnVerHistoricoCompleto");
  btnHistorico.onclick = () => {
    const tbodyHistorico = document.getElementById("historialPagosSocioBody");
    document.getElementById("tituloHistoricoSocio").textContent = `Histórico de Pagos: ${socio.nombre || "Socio"}`;
    tbodyHistorico.innerHTML = "";

    if (arrayPagosGlobal.length === 0) {
      tbodyHistorico.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No hay pagos registrados para este socio.</td></tr>`;
    } else {
      const ultimosCincoPagos = arrayPagosGlobal.slice(0, 5);

      ultimosCincoPagos.forEach((pago) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${pago.nombreCuota || "Cuota"}</td>
          <td>${pago.fechaPago || "-"}</td>
          <td style="text-align: right; font-weight: 600;">${pago.monto ? pago.monto + "€" : ""}</td>
        `;
        tbodyHistorico.appendChild(tr);
      });
    }
    document.getElementById("modalHistoricoCompleto").style.display = "flex";
  };

  const btnRegistrarPago = document.getElementById("btnRegistrarPagoSocio");
  const nuevoBtnRegistrarPago = btnRegistrarPago.cloneNode(true);
  btnRegistrarPago.parentNode.replaceChild(nuevoBtnRegistrarPago, btnRegistrarPago);

  nuevoBtnRegistrarPago.addEventListener("click", async () => {
    const select = document.getElementById("selectCuotaConfig");
    const selectedOption = select.options[select.selectedIndex];
    const cuotaId = select.value;

    if (!cuotaId) {
      mostrarModalError("Atención", "Por favor, selecciona un concepto de cuota.");
      return;
    }

    const nombreCuota = selectedOption.dataset.nombre;
    const monto = selectedOption.dataset.importe;

    try {
      await addDoc(collection(db, "pagos"), {
        socioId: socioId,
        socioNombre: socio.nombre || "Socio",
        cuotaId: cuotaId,
        nombreCuota: nombreCuota,
        monto: parseFloat(monto),
        fechaPago: new Date().toISOString().split('T')[0],
        organizationId: currentUserOrgId
      });

      await registrarLog(`SOCIOS: Registro de pago de cuota "${nombreCuota}" (${monto}€) al socio ${socio.nombre || "Sin nombre"} (DNI: ${socio.dni || "Sin DNI"})`);

      mostrarModalExito("¡Pago registrado!", "El pago se ha registrado con éxito.", () => {
        abrirPerfilSocio(socioId, socio);
      });
    } catch (e) {
      console.error("Error al registrar pago:", e);
      mostrarModalError("Error", "Hubo un error al registrar el pago.");
    }
  });

  document.getElementById("modalPerfilSocio").style.display = "flex";
}

function mostrarModalConfirmacionBorrado(socio, pagosSocio, socioId) {
  let modalBorrado = document.getElementById("modalConfirmarBorradoSocio");
  
  if (!modalBorrado) {
    modalBorrado = document.createElement("div");
    modalBorrado.id = "modalConfirmarBorradoSocio";
    modalBorrado.className = "modal-overlay";
    modalBorrado.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); z-index: 1200; align-items: center; justify-content: center; padding: 1rem;";
    
    document.body.appendChild(modalBorrado);
  }

  modalBorrado.innerHTML = `
    <div id="cajaContenidoBorrado" class="content-card" style="width: 100%; max-width: 440px; margin: auto; animation: fadeIn 0.2s ease; text-align: center; padding: 2rem 1.5rem;">
      <div id="iconoBorradoContainer" style="width: 48px; height: 48px; border-radius: 50%; background: #fee2e2; color: var(--danger); display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </div>
      <h3 id="tituloBorradoModal" class="card-item-title" style="margin-bottom: 0.5rem; font-size: 1.25rem;">¿Eliminar socio por completo?</h3>
      <p id="textoAvisoBorrado" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
        Estás a punto de eliminar al socio y todos sus datos asociados.
      </p>
      <div id="botonesAccionBorrado" style="display: flex; gap: 0.75rem;">
        <button type="button" id="btnCancelarBorradoTotal" class="btn-secondary" style="flex: 1;">Cancelar</button>
        <button type="button" id="btnConfirmarBorradoTotal" class="btn-secondary" style="flex: 1; background-color: var(--danger); color: #fff; border-color: var(--danger);">Sí, eliminar todo</button>
      </div>
    </div>
  `;

  const textoAviso = document.getElementById("textoAvisoBorrado");
  const cantidadPagos = pagosSocio.length;
  
  if (cantidadPagos > 0) {
    textoAviso.innerHTML = `Vas a eliminar a <strong>${socio.nombre || 'este socio'}</strong> junto con su historial completo, lo que incluye <strong>${cantidadPagos} pago(s) registrado(s)</strong>. Esta acción no se puede deshacer.`;
  } else {
    textoAviso.innerHTML = `Vas a eliminar a <strong>${socio.nombre || 'este socio'}</strong> y todos sus datos asociados. Esta acción no se puede deshacer.`;
  }

  modalBorrado.style.display = "flex";

  const btnCancelar = document.getElementById("btnCancelarBorradoTotal");
  const btnConfirmar = document.getElementById("btnConfirmarBorradoTotal");

  btnCancelar.addEventListener("click", () => {
    modalBorrado.style.display = "none";
  });

  btnConfirmar.addEventListener("click", async () => {
    btnConfirmar.disabled = true;
    btnCancelar.disabled = true;
    btnConfirmar.textContent = "Eliminando...";

    try {
      const batch = writeBatch(db);
      const socioRef = doc(db, "socios", socioId);
      batch.delete(socioRef);

      pagosSocio.forEach(pago => {
        const pagoRef = doc(db, "pagos", pago.id);
        batch.delete(pagoRef);
      });

      await batch.commit();

      await registrarLog(`SOCIOS: Eliminación del socio: ${socio.nombre || "Sin nombre"} (DNI: ${socio.dni || "Sin DNI"}) junto a su historial de pagos.`);

      const iconoContainer = document.getElementById("iconoBorradoContainer");
      iconoContainer.style.background = "#dcfce7";
      iconoContainer.style.color = "#16a34a";
      iconoContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      
      document.getElementById("tituloBorradoModal").textContent = "¡Eliminado con éxito!";
      document.getElementById("textoAvisoBorrado").textContent = "El socio y todos sus pagos asociados han sido borrados correctamente.";
      document.getElementById("botonesAccionBorrado").style.display = "none";

      setTimeout(async () => {
        modalBorrado.style.display = "none";
        document.getElementById("modalPerfilSocio").style.display = "none";
        await cargarSociosDeOrg(currentUserOrgId);
      }, 1200);

    } catch (error) {
      console.error("Error al eliminar el socio y sus pagos:", error);
      mostrarModalError("Error", "Hubo un error al intentar eliminar todos los registros.");
      modalBorrado.style.display = "none";
      btnConfirmar.disabled = false;
      btnCancelar.disabled = false;
    }
  });
}

function entrarModoEdicionPerfil() {
  const spans = document.querySelectorAll(".popup-field-value");
  const inputs = document.querySelectorAll(".popup-input-edit");
  
  spans.forEach(el => el.style.display = "none");
  inputs.forEach(el => el.style.display = "block");
  
  const footerAcciones = document.getElementById("footerEdicionAcciones");
  if (footerAcciones) footerAcciones.style.display = "flex";
}

function salirModoEdicionPerfil() {
  const spans = document.querySelectorAll(".popup-field-value");
  const inputs = document.querySelectorAll(".popup-input-edit");
  
  spans.forEach(el => el.style.display = "block");
  inputs.forEach(el => el.style.display = "none");
  
  const footerAcciones = document.getElementById("footerEdicionAcciones");
  if (footerAcciones) footerAcciones.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const modalNuevo = document.getElementById("modalNuevoSocio");
  const modalPerfil = document.getElementById("modalPerfilSocio");
  const modalHistorico = document.getElementById("modalHistoricoCompleto");
  
  const btnNuevo = document.getElementById("btnNuevoSocio");
  const btnCerrarNuevo = document.getElementById("btnCerrarModal");
  const btnCancelar = document.getElementById("btnCancelarSocio");
  const btnCerrarPerfil = document.getElementById("btnCerrarPerfil");
  const btnCerrarHistorico = document.getElementById("btnCerrarHistorico");
  const btnCerrarHistoricoFooter = document.getElementById("btnCerrarHistoricoFooter");
  
  const form = document.getElementById("formNuevoSocio");

  if (btnNuevo) btnNuevo.addEventListener("click", () => modalNuevo.style.display = "flex");
  if (btnCerrarNuevo) btnCerrarNuevo.addEventListener("click", () => { modalNuevo.style.display = "none"; form.reset(); });
  if (btnCancelar) btnCancelar.addEventListener("click", () => { modalNuevo.style.display = "none"; form.reset(); });
  if (btnCerrarPerfil) btnCerrarPerfil.addEventListener("click", () => modalPerfil.style.display = "none");
  if (btnCerrarHistorico) btnCerrarHistorico.addEventListener("click", () => modalHistorico.style.display = "none");
  if (btnCerrarHistoricoFooter) btnCerrarHistoricoFooter.addEventListener("click", () => modalHistorico.style.display = "none");

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!currentUserOrgId) {
        mostrarModalError("Error", "No se ha detectado la organización.");
        return;
      }

      const telefonoInput = document.getElementById("socioTelefono").value.trim();
      if (!/^\d+$/.test(telefonoInput)) {
        mostrarModalError("Dato inválido", "El teléfono debe contener únicamente números.");
        return;
      }

      const nacimientoInput = document.getElementById("socioNacimiento").value.trim();
      const altaInput = document.getElementById("socioFechaAlta").value.trim();
      const esFederado = document.getElementById("socioFederado").value === "si";

      const regexFechaCompleta = /^\d{4}-\d{2}-\d{2}$/;
      if (!regexFechaCompleta.test(nacimientoInput) || !regexFechaCompleta.test(altaInput)) {
        mostrarModalError("Fecha inválida", "Introduce una fecha completa válida (Año de 4 dígitos, mes y día).");
        return;
      }

      const nuevoSocioData = {
        nombre: document.getElementById("socioNombre").value.trim(),
        sexo: document.getElementById("socioSexo").value,
        direccion: document.getElementById("socioDireccion").value.trim(),
        localidad: document.getElementById("socioLocalidad").value.trim(),
        provincia: document.getElementById("socioProvincia").value.trim(),
        nacimiento: nacimientoInput,
        dni: document.getElementById("socioDni").value.trim(),
        telefono: telefonoInput,
        correo: document.getElementById("socioCorreo").value.trim(),
        fechaAlta: altaInput,
        organizationId: currentUserOrgId,
        createdAt: new Date()
      };

      try {
        await addDoc(collection(db, "socios"), nuevoSocioData);

        if (esFederado) {
          const nombresSeparados = separarNombreYApellidos(nuevoSocioData.nombre);
          await addDoc(collection(db, "federacion"), {
            nombre: nombresSeparados.nombre,
            apellidos: nombresSeparados.apellidos,
            nacimiento: nuevoSocioData.nacimiento,
            dni: nuevoSocioData.dni,
            organizationId: currentUserOrgId,
            createdAt: serverTimestamp()
          });
        }

        await registrarLog(`SOCIOS: Creación manual del socio: ${nuevoSocioData.nombre} (DNI: ${nuevoSocioData.dni})${esFederado ? ' [Federado]' : ''}`);

        modalNuevo.style.display = "none";
        form.reset();
        mostrarModalExito("¡Socio registrado!", "El nuevo socio se ha registrado con éxito.", async () => {
          await cargarSociosDeOrg(currentUserOrgId);
        });
      } catch (error) {
        console.error("Error al guardar el socio:", error);
        mostrarModalError("Error", "Hubo un error al registrar el socio.");
      }
    });
  }
});