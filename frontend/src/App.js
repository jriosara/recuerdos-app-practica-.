import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [recuerdos, setRecuerdos] = useState([]);
  const [formulario, setFormulario] = useState({
    titulo: '',
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0],
    foto: null
  });
  const [editando, setEditando] = useState(null);
  const [vistaDetalle, setVistaDetalle] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    cargarRecuerdos();
  }, []);

  const cargarRecuerdos = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/recuerdos`);
      setRecuerdos(response.data);
    } catch (error) {
      alert('Error al cargar recuerdos');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setCargando(true);

    const formData = new FormData();
    formData.append('titulo', formulario.titulo);
    formData.append('descripcion', formulario.descripcion);
    formData.append('fecha', formulario.fecha);
    if (formulario.foto) {
      formData.append('foto', formulario.foto);
    }

    try {
  if (editando) {
    await axios.put(
      `${API_URL}/api/recuerdos/${editando}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    alert('Recuerdo actualizado');
  } else {
    await axios.post(
      `${API_URL}/api/recuerdos`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    alert('Recuerdo guardado');
  }

  setFormulario({
    titulo: '',
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0],
    foto: null
  });

  setEditando(null);
  cargarRecuerdos();

} catch (error) {
  console.error('ERROR AL GUARDAR:', error);
  alert('Error al guardar recuerdo');
} finally {
  setCargando(false);
}
  };

  const eliminarRecuerdo = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar este recuerdo?')) return;

    try {
      await axios.delete(`${API_URL}/api/recuerdos/${id}`);
      alert('Recuerdo eliminado');
      cargarRecuerdos();
    } catch (error) {
      alert('Error al eliminar recuerdo');
    }
  };

  const editarRecuerdo = (recuerdo) => {
    setFormulario({
      titulo: recuerdo.titulo,
      descripcion: recuerdo.descripcion,
      fecha: recuerdo.fecha.split('T')[0],
      foto: null
    });
    setEditando(recuerdo.id);
  };

  return (
  <div className="contenedor">

    <h1>📸 Mis Recuerdos</h1>
    <p>Guarda tus momentos especiales en la Nube</p>

    {/* Formulario */}
    <div className="formulario">
      <h2>{editando ? 'Editar Recuerdo' : 'Nuevo Recuerdo'}</h2>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Título del recuerdo"
          value={formulario.titulo}
          onChange={(e) => setFormulario({ ...formulario, titulo: e.target.value })}
          required
        />

        <textarea
          placeholder="Descripción"
          value={formulario.descripcion}
          onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })}
          rows="4"
        />

        <input
          type="date"
          value={formulario.fecha}
          onChange={(e) => setFormulario({ ...formulario, fecha: e.target.value })}
          required
        />

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFormulario({ ...formulario, foto: e.target.files[0] })}
          required={!editando}
        />

        <button type="submit">
          {cargando ? 'Guardando...' : (editando ? 'Actualizar' : 'Guardar')}
        </button>

        {editando && (
          <button
            type="button"
            className="cancelar"
            onClick={() => {
              setEditando(null);
              setFormulario({
                titulo: '',
                descripcion: '',
                fecha: new Date().toISOString().split('T')[0],
                foto: null
              });
            }}
          >
            Cancelar
          </button>
        )}
      </form>
    </div>

    {/* Lista de recuerdos */}
    <h2>Mis Recuerdos ({recuerdos.length})</h2>

    <div className="lista-recuerdos">
      {recuerdos.map((recuerdo) => (
        <div key={recuerdo.id} className="card-recuerdo">

          <img
            src={recuerdo.url_foto}
            alt={recuerdo.titulo}
            onClick={() => setVistaDetalle(recuerdo)}
          />

          <h3>{recuerdo.titulo}</h3>
          <p>{new Date(recuerdo.fecha).toLocaleDateString()}</p>
          <p>{recuerdo.descripcion}</p>

          <button onClick={() => editarRecuerdo(recuerdo)}>✏️ Editar</button>

          <button onClick={() => eliminarRecuerdo(recuerdo.id)} className="eliminar">
            🗑️ Eliminar
          </button>

        </div>
      ))}
    </div>

    {/* Modal Detalle */}
    {vistaDetalle && (
      <div className="modal" onClick={() => setVistaDetalle(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <span className="close" onClick={() => setVistaDetalle(null)}>&times;</span>

          <h3>{vistaDetalle.titulo}</h3>
          <p>{new Date(vistaDetalle.fecha).toLocaleDateString()}</p>
          <p>{vistaDetalle.descripcion}</p>

          <img
            src={vistaDetalle.url_foto}
            alt={vistaDetalle.titulo}
            className="modal-img"
          />
        </div>
      </div>
    )}

  </div>
);
}

export default App;