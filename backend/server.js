require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('./'));

// PostgreSQL Pool Configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'carbon_footprint_db'
});

// ตรวจสอบการเชื่อมต่อฐานข้อมูล
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL Database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
});

// สร้างตารางอัตโนมัติ (ครั้งแรก)
async function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20),
      category VARCHAR(50),
      answers JSONB,
      avg_score DECIMAL(3, 2),
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_category ON assessments(category);
    CREATE INDEX IF NOT EXISTS idx_created_at ON assessments(created_at);
  `;

  try {
    await pool.query(createTableQuery);
    console.log('✅ Database tables initialized successfully');
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
}

// บันทึกข้อมูลการประเมิน
app.post('/api/assessment', async (req, res) => {
  const { name, email, phone, category, answers, avgScore, comment } = req.body;
  
  try {
    const query = `
      INSERT INTO assessments (name, email, phone, category, answers, avg_score, comment)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;
    
    const values = [name, email, phone, category, JSON.stringify(answers), avgScore, comment];
    const result = await pool.query(query, values);
    
    res.json({ status: 'ok', id: result.rows[0].id });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ดึงข้อมูลการประเมินทั้งหมด
app.get('/api/assessments', async (req, res) => {
  try {
    const query = 'SELECT * FROM assessments ORDER BY created_at DESC;';
    const result = await pool.query(query);
    
    const data = result.rows.map(row => ({
      ...row,
      answers: row.answers,
      avgScore: parseFloat(row.avg_score)
    }));
    
    res.json(data);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ดึงข้อมูลตามหมวดหมู่
app.get('/api/assessments/:category', async (req, res) => {
  const { category } = req.params;
  
  try {
    const query = 'SELECT * FROM assessments WHERE category = $1 ORDER BY created_at DESC;';
    const result = await pool.query(query, [category]);
    
    const data = result.rows.map(row => ({
      ...row,
      answers: row.answers,
      avgScore: parseFloat(row.avg_score)
    }));
    
    res.json(data);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ดึงสรุปผลการประเมิน
app.get('/api/summary', async (req, res) => {
  try {
    const query = `
      SELECT 
        category, 
        COUNT(*) as count, 
        AVG(avg_score) as avg_score
      FROM assessments
      GROUP BY category;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ส่งออกเป็น CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const query = 'SELECT * FROM assessments ORDER BY created_at DESC;';
    const result = await pool.query(query);

    let csv = 'ลำดับที่,ชื่อ-สกุล,อีเมล,เบอร์โทร,หมวดหมู่,คะแนนเฉลี่ย,ความเห็น,วันที่\n';
    
    result.rows.forEach((row, index) => {
      csv += `${index + 1},"${row.name}","${row.email}","${row.phone || ''}","${row.category}",${row.avg_score},"${row.comment || ''}","${row.created_at}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="assessment_results.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send('Database error');
  }
});

// ส่งออกเป็น TXT
app.get('/api/export/txt', async (req, res) => {
  try {
    const query = 'SELECT * FROM assessments ORDER BY created_at DESC;';
    const result = await pool.query(query);

    let text = '';
    text += '═══════════════════════════════════════════════════════════\n';
    text += '         สรุปผลการประเมิน Carbon Footprint for School\n';
    text += '═══════════════════════════════════════════════════════════\n\n';

    result.rows.forEach((row, index) => {
      text += `ลำดับที่: ${index + 1}\n`;
      text += `ชื่อ-สกุล: ${row.name}\n`;
      text += `อีเมล: ${row.email}\n`;
      text += `เบอร์โทร: ${row.phone || '-'}\n`;
      text += `หมวดหมู่: ${row.category}\n`;
      text += `คะแนนเฉลี่ย: ${row.avg_score}/5.00\n`;
      text += `ความเห็น: ${row.comment || '-'}\n`;
      text += `วันที่: ${row.created_at}\n`;
      text += '───────────────────────────────────────────────────────────\n\n';
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="assessment_results.txt"');
    res.send(text);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send('Database error');
  }
});

// ดึงข้อมูลสถิติ
app.get('/api/stats', async (req, res) => {
  try {
    const query = 'SELECT * FROM assessments;';
    const result = await pool.query(query);

    const stats = {
      totalCount: result.rows.length,
      avgScore: result.rows.length > 0 ? 
        (result.rows.reduce((sum, r) => sum + parseFloat(r.avg_score), 0) / result.rows.length).toFixed(2) 
        : 0,
      categories: {}
    };

    result.rows.forEach(row => {
      if (!stats.categories[row.category]) {
        stats.categories[row.category] = { count: 0, avgScore: 0, scores: [] };
      }
      stats.categories[row.category].count++;
      stats.categories[row.category].scores.push(parseFloat(row.avg_score));
    });

    Object.keys(stats.categories).forEach(cat => {
      const scores = stats.categories[cat].scores;
      stats.categories[cat].avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
      delete stats.categories[cat].scores;
    });

    res.json(stats);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// เริ่มต้น Server
const PORT = process.env.SERVER_PORT || 3000;

(async () => {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`✅ Backend running at http://localhost:${PORT}`);
      console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin.html`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n📍 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
