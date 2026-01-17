const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Clave secreta para JWT (debería estar en .env, pero usaremos un default para dev)
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_123';

// Configuración de CORS
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://recuerdos-app.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        username varchar(50) NOT NULL UNIQUE,
        password varchar(255) NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recuerdos (
        id serial PRIMARY KEY,
        user_id integer REFERENCES users(id) ON DELETE CASCADE,
        titulo varchar(255) NOT NULL,
        descripcion text,
        fecha date NOT NULL,
        url_foto varchar(500) NOT NULL,
        public_id varchar(255) NOT NULL,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);
  } catch (err) {
    console.error('Error al inicializar DB:', err);
  }
};

initDB();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'recuerdos';

const upload = multer({
  storage: multer.memoryStorage()
});

// --- MIDDLEWARE DE AUTENTICACIÓN ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.sendStatus(401); // No autorizado

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Token inválido
    req.user = user;
    next();
  });
};


// --- RUTAS DE AUTENTICACIÓN ---

// Registro
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2)',
      [username, hashedPassword]
    );

    res.status(201).json({ message: 'Usuario registrado exitosamente' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows: users } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (users.length === 0) return res.status(400).json({ error: 'Usuario no encontrado' });

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.status(400).json({ error: 'Contraseña incorrecta' });

    // Crear token
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, username: user.username });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});


// --- RUTAS DE RECUERDOS (PROTEGIDAS) ---

// Obtener todos los recuerdos DEL USUARIO
app.get('/api/recuerdos', authenticateToken, async (req, res) => {
  try {
    const { search, year, month, order } = req.query;
    const userId = req.user.id;
    
    let query = 'SELECT * FROM recuerdos WHERE user_id = $1';
    const params = [userId];
    let index = 2;
    
    if (search) {
      query += ` AND titulo ILIKE $${index}`;
      params.push(`%${search}%`);
      index++;
    }

    if (year) {
      query += ` AND EXTRACT(YEAR FROM fecha) = $${index}`;
      params.push(year);
      index++;
    }

    if (month) {
      query += ` AND EXTRACT(MONTH FROM fecha) = $${index}`;
      params.push(month);
      index++;
    }

    if (order === 'antiguo') {
      query += ' ORDER BY fecha ASC';
    } else {
      query += ' ORDER BY fecha DESC';
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener recuerdos' });
  }
});

// Obtener un recuerdo por ID (Solo si es del usuario)
app.get('/api/recuerdos/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM recuerdos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Recuerdo no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener recuerdo' });
  }
});

// Crear nuevo recuerdo
app.post('/api/recuerdos', authenticateToken, upload.single('foto'), async (req, res) => {
  try {
    const { titulo, descripcion, fecha } = req.body;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'La foto es obligatoria' });
    }

    const file = req.file;
    const filePath = `recuerdos/${Date.now()}-${file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype
      });

    if (uploadError) {
      return res.status(500).json({ error: 'Error al subir imagen' });
    }

    const { data: publicData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicData.publicUrl;

    const result = await pool.query(
      'INSERT INTO recuerdos (titulo, descripcion, fecha, url_foto, public_id, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [
        titulo,
        descripcion,
        fecha,
        publicUrl,
        filePath,
        userId
      ]
    );

    res.status(201).json({
      id: result.rows[0].id,
      titulo,
      descripcion,
      fecha,
      url_foto: publicUrl,
      message: 'Recuerdo creado exitosamente'
    });

  } catch (error) {
    console.error('🔥 ERROR:', error);
    res.status(500).json({ error: 'Error al crear recuerdo' });
  }
});


// Actualizar recuerdo
app.put('/api/recuerdos/:id', authenticateToken, upload.single('foto'), async (req, res) => {
  try {
    const { titulo, descripcion, fecha } = req.body;
    const { id } = req.params;
    const userId = req.user.id;

    const { rows: existing } = await pool.query('SELECT * FROM recuerdos WHERE id = $1 AND user_id = $2', [id, userId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Recuerdo no encontrado o no autorizado' });
    }

    let updateQuery, params;

    if (req.file) {
      await supabase.storage
        .from(SUPABASE_BUCKET)
        .remove([existing[0].public_id]);

      const file = req.file;
      const filePath = `recuerdos/${Date.now()}-${file.originalname}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype
        });

      if (uploadError) {
        return res.status(500).json({ error: 'Error al subir imagen' });
      }

      const { data: publicData } = supabase.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(filePath);

      const publicUrl = publicData.publicUrl;

      updateQuery = 'UPDATE recuerdos SET titulo = $1, descripcion = $2, fecha = $3, url_foto = $4, public_id = $5 WHERE id = $6';
      params = [titulo, descripcion, fecha, publicUrl, filePath, id];
    } else {
      updateQuery = 'UPDATE recuerdos SET titulo = $1, descripcion = $2, fecha = $3 WHERE id = $4';
      params = [titulo, descripcion, fecha, id];
    }

    await pool.query(updateQuery, params);
    res.json({ message: 'Recuerdo actualizado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar recuerdo' });
  }
});

// Eliminar recuerdo
app.delete('/api/recuerdos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { rows } = await pool.query('SELECT public_id FROM recuerdos WHERE id = $1 AND user_id = $2', [id, userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Recuerdo no encontrado o no autorizado' });
    }
    
    await supabase.storage
      .from(SUPABASE_BUCKET)
      .remove([rows[0].public_id]);

    await pool.query('DELETE FROM recuerdos WHERE id = $1', [id]);
    
    res.json({ message: 'Recuerdo eliminado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar recuerdo' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
