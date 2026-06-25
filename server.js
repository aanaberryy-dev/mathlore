const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();
const PORT = 3000;
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'teacher', name TEXT, phone TEXT DEFAULT '', notes TEXT DEFAULT '', subject TEXT DEFAULT '', level TEXT DEFAULT '', goals TEXT DEFAULT '', status TEXT DEFAULT 'active', avatar TEXT DEFAULT 'default.png', tariff TEXT DEFAULT 'premium', theme TEXT DEFAULT 'light', currency TEXT DEFAULT 'BYN', team_id INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, date_time TEXT, status TEXT DEFAULT 'planned', price REAL, topic TEXT DEFAULT '', duration INTEGER DEFAULT 60, link TEXT DEFAULT '', materials TEXT DEFAULT '', grade INTEGER DEFAULT 0, teacher_comment TEXT DEFAULT '', homework TEXT DEFAULT '', lesson_notes TEXT DEFAULT '', student_mood INTEGER DEFAULT 3, plan_next TEXT DEFAULT '', draft TEXT DEFAULT '', is_group INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS homeworks (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, title TEXT, description TEXT, deadline TEXT, status TEXT DEFAULT 'assigned', file TEXT, grade TEXT, feedback TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, amount REAL, date TEXT, type TEXT DEFAULT 'income', description TEXT DEFAULT '', category TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, lessons_total INTEGER, lessons_left INTEGER, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'active')`);
  db.run(`CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, folder TEXT DEFAULT 'Общая', title TEXT, file_url TEXT, description TEXT, created_at TEXT DEFAULT (date('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, created_at TEXT, month TEXT, total REAL, status TEXT DEFAULT 'active')`);
  db.run(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, name TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS student_tags (student_id INTEGER, tag_id INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, name TEXT, content TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, text TEXT, created_at TEXT DEFAULT (date('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, student_id INTEGER, title TEXT, done INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS groups_table (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, name TEXT, subject TEXT DEFAULT '', level TEXT DEFAULT '', description TEXT DEFAULT '', status TEXT DEFAULT 'active', price REAL DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_students (group_id INTEGER, student_id INTEGER)`);
});

const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'journal-secret', resave: false, saveUninitialized: false }));

function auth(req, res, next) { if (req.session.user) next(); else res.redirect('/login'); }

// ПРОМО-СТРАНИЦА
app.get('/', (req, res) => res.render('index'));

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email=?', [email], (err, user) => {
    if (user && bcrypt.compareSync(password, user.password)) { req.session.user = user; res.redirect('/dashboard'); }
    else res.render('login', { error: 'Неверный логин или пароль' });
  });
});
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  db.get('SELECT * FROM users WHERE email=?', [email], (err, exists) => {
    if (exists) return res.render('register', { error: 'Email занят' });
    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (email,password,name) VALUES (?,?,?)", [email, hash, name], function() {
      db.get('SELECT * FROM users WHERE id=?', [this.lastID], (err, user) => { req.session.user = user; res.redirect('/dashboard'); });
    });
  });
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ГЛАВНАЯ
app.get('/dashboard', auth, (req, res) => {
  const uid = req.session.user.id;
  db.all("SELECT lessons.*, users.name as student_name, users.subject as subj, users.level as lvl FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.teacher_id=? AND date(lessons.date_time)=date('now') ORDER BY lessons.date_time", [uid], (err, today) => {
    const ym = new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');
    db.get("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE teacher_id=? AND type='income' AND date LIKE ?", [uid, ym+'%'], (err, inc) => {
      db.get("SELECT COUNT(*) as cnt FROM users WHERE role='student' AND status='active'", (err, students) => {
        db.get("SELECT COUNT(*) as cnt FROM homeworks WHERE teacher_id=? AND status='submitted'", [uid], (err, pending) => {
          db.get("SELECT lessons.*, users.name as student_name, users.subject as subj, users.level as lvl FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.teacher_id=? AND date(lessons.date_time)>=date('now') AND lessons.status='planned' ORDER BY lessons.date_time LIMIT 1", [uid], (err, nextLesson) => {
            db.all("SELECT subscriptions.*, users.name as student_name FROM subscriptions JOIN users ON subscriptions.student_id=users.id WHERE subscriptions.teacher_id=? AND subscriptions.lessons_left<=2 AND subscriptions.status='active'", [uid], (err, expiringSubs) => {
              db.all("SELECT * FROM notes WHERE teacher_id=? ORDER BY created_at DESC LIMIT 5", [uid], (err, notes) => {
                res.render('teacher/dashboard', { user: req.session.user, todayLessons: today||[], totalIncome: inc?.total||0, totalStudents: students?.cnt||0, pendingCount: pending?.cnt||0, nextLesson: nextLesson||null, expiringSubs: expiringSubs||[], notes: notes||[] });
              });
            });
          });
        });
      });
    });
  });
});

app.post('/notes/add', auth, (req, res) => { db.run("INSERT INTO notes (teacher_id,text) VALUES (?,?)", [req.session.user.id, req.body.text], () => res.redirect('/dashboard')); });
app.get('/notes/delete/:id', auth, (req, res) => { db.run('DELETE FROM notes WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], () => res.redirect('/dashboard')); });
app.get('/theme/:t', auth, (req, res) => { db.run('UPDATE users SET theme=? WHERE id=?', [req.params.t, req.session.user.id], () => { req.session.user.theme = req.params.t; res.redirect('/dashboard'); }); });

// УЧЕНИКИ
app.get('/students', auth, (req, res) => {
  const tag = req.query.tag || ''; let q = "SELECT * FROM users WHERE role='student'"; let p = [];
  if (tag) { q += " AND id IN (SELECT student_id FROM student_tags WHERE tag_id=(SELECT id FROM tags WHERE name=? AND teacher_id=?))"; p.push(tag, req.session.user.id); }
  q += " ORDER BY name";
  db.all(q, p, (err, students) => { db.all("SELECT * FROM tags WHERE teacher_id=?", [req.session.user.id], (err, tags) => { res.render('teacher/students', { user: req.session.user, students: students||[], tags: tags||[], currentTag: tag }); }); });
});
app.get('/students/create', auth, (req, res) => res.render('teacher/create-student', { user: req.session.user, error: null, generatedLogin: null, generatedPassword: null }));
app.post('/students/create', auth, (req, res) => {
  const { name, email, phone, subject, level, goals } = req.body;
  db.get('SELECT * FROM users WHERE email=?', [email], (err, exists) => {
    if (exists) return res.render('teacher/create-student', { user: req.session.user, error: 'Email занят', generatedLogin: null, generatedPassword: null });
    const pass = Math.random().toString(36).slice(-6); const hash = bcrypt.hashSync(pass, 10);
    db.run("INSERT INTO users (email,password,role,name,phone,subject,level,goals) VALUES (?,?,?,?,?,?,?,?)", [email, hash, 'student', name, phone||'', subject||'', level||'', goals||''], () => res.render('teacher/create-student', { user: req.session.user, error: null, generatedLogin: email, generatedPassword: pass }));
  });
});
app.post('/students/import', auth, upload.single('csvfile'), (req, res) => {
  if (!req.file) return res.send('Файл не загружен');
  const csv = fs.readFileSync(req.file.path, 'utf-8');
  csv.split('\n').slice(1).forEach(line => {
    const [name, email, phone, subject, level] = line.split(',').map(s => (s||'').trim());
    if (name && email) { const pass = Math.random().toString(36).slice(-6); db.run("INSERT OR IGNORE INTO users (email,password,role,name,phone,subject,level) VALUES (?,?,?,?,?,?,?)", [email, bcrypt.hashSync(pass,10), 'student', name, phone||'', subject||'', level||'']); }
  });
  res.redirect('/students');
});
app.get('/students/:id', auth, (req, res) => {
  db.get('SELECT * FROM users WHERE id=?', [req.params.id], (err, s) => {
    if (!s) return res.redirect('/students');
    db.all('SELECT * FROM lessons WHERE student_id=? AND teacher_id=? ORDER BY date_time DESC LIMIT 50', [req.params.id, req.session.user.id], (err, lessons) => {
      db.all('SELECT * FROM homeworks WHERE student_id=? AND teacher_id=? ORDER BY deadline DESC', [req.params.id, req.session.user.id], (err, hw) => {
        db.all('SELECT * FROM payments WHERE student_id=? AND teacher_id=? ORDER BY date DESC', [req.params.id, req.session.user.id], (err, pay) => {
          db.all('SELECT * FROM subscriptions WHERE student_id=? AND teacher_id=?', [req.params.id, req.session.user.id], (err, subs) => {
            db.all("SELECT * FROM goals WHERE student_id=? AND teacher_id=?", [req.params.id, req.session.user.id], (err, goals) => {
              db.all("SELECT tags.name FROM student_tags JOIN tags ON student_tags.tag_id=tags.id WHERE student_tags.student_id=?", [req.params.id], (err, tags) => {
                db.all("SELECT * FROM tags WHERE teacher_id=?", [req.session.user.id], (err, allTags) => {
                  res.render('teacher/student-card', { user: req.session.user, student: s, lessons: lessons||[], homeworks: hw||[], payments: pay||[], subs: subs||[], goals: goals||[], studentTags: tags||[], allTags: allTags||[] });
                });
              });
            });
          });
        });
      });
    });
  });
});
app.post('/students/:id', auth, (req, res) => { const { name, email, phone, subject, level, goals, notes, status } = req.body; db.run('UPDATE users SET name=?,email=?,phone=?,subject=?,level=?,goals=?,notes=?,status=? WHERE id=?', [name, email, phone||'', subject||'', level||'', goals||'', notes||'', status||'active', req.params.id], () => res.redirect('/students/'+req.params.id)); });
app.get('/students/:id/delete', auth, (req, res) => { db.run('DELETE FROM lessons WHERE student_id=?', [req.params.id]); db.run('DELETE FROM homeworks WHERE student_id=?', [req.params.id]); db.run('DELETE FROM payments WHERE student_id=?', [req.params.id]); db.run('DELETE FROM users WHERE id=?', [req.params.id], () => res.redirect('/students')); });
app.get('/students/:id/progress', auth, (req, res) => { db.get('SELECT * FROM users WHERE id=?', [req.params.id], (err, student) => { if (!student) return res.redirect('/students'); db.all("SELECT * FROM lessons WHERE student_id=? AND teacher_id=? AND status='done' ORDER BY date_time", [req.params.id, req.session.user.id], (err, lessons) => res.render('teacher/student-progress', { user: req.session.user, student, lessons: lessons||[] })); }); });
app.get('/students/:id/report', auth, (req, res) => { db.get('SELECT * FROM users WHERE id=?', [req.params.id], (err, student) => { if (!student) return res.redirect('/students'); db.all("SELECT * FROM lessons WHERE student_id=? AND teacher_id=? ORDER BY date_time", [req.params.id, req.session.user.id], (err, lessons) => { db.all("SELECT * FROM homeworks WHERE student_id=? AND teacher_id=? ORDER BY deadline", [req.params.id, req.session.user.id], (err, hw) => { db.all("SELECT * FROM payments WHERE student_id=? AND teacher_id=? ORDER BY date", [req.params.id, req.session.user.id], (err, pay) => { res.render('teacher/student-report', { user: req.session.user, student, lessons: lessons||[], homeworks: hw||[], payments: pay||[] }); }); }); }); }); });
app.post('/students/:id/tags', auth, (req, res) => { db.run("INSERT OR IGNORE INTO student_tags (student_id, tag_id) VALUES (?,?)", [req.params.id, req.body.tag_id], () => res.redirect('/students/'+req.params.id)); });
app.get('/students/:id/tags/delete/:tagId', auth, (req, res) => { db.run("DELETE FROM student_tags WHERE student_id=? AND tag_id=?", [req.params.id, req.params.tagId], () => res.redirect('/students/'+req.params.id)); });
app.post('/tags/add', auth, (req, res) => { db.run("INSERT INTO tags (teacher_id, name) VALUES (?,?)", [req.session.user.id, req.body.name], () => res.redirect('/students')); });
app.post('/students/:id/goals', auth, (req, res) => { db.run("INSERT INTO goals (teacher_id, student_id, title) VALUES (?,?,?)", [req.session.user.id, req.params.id, req.body.title], () => res.redirect('/students/'+req.params.id)); });
app.get('/goals/toggle/:id', auth, (req, res) => { db.get('SELECT * FROM goals WHERE id=?', [req.params.id], (err, g) => { db.run('UPDATE goals SET done=? WHERE id=?', [g.done?0:1, req.params.id], () => res.redirect('/students/'+g.student_id)); }); });

// ГРУППЫ
app.get('/groups', auth, (req, res) => { db.all("SELECT * FROM groups_table WHERE teacher_id=? ORDER BY name", [req.session.user.id], (err, groups) => { db.all("SELECT id, name FROM users WHERE role='student'", (err, allStudents) => { res.render('teacher/groups', { user: req.session.user, groups: groups||[], allStudents: allStudents||[] }); }); }); });
app.post('/groups/add', auth, (req, res) => {
  const { name, subject, level, description, price } = req.body;
  db.run("INSERT INTO groups_table (teacher_id, name, subject, level, description, price) VALUES (?,?,?,?,?,?)", [req.session.user.id, name, subject||'', level||'', description||'', price||0], function() {
    const groupId = this.lastID;
    if (req.body.students) { const ids = req.body.students.split(','); ids.forEach(sid => { if (sid) db.run("INSERT OR IGNORE INTO group_students (group_id, student_id) VALUES (?,?)", [groupId, sid]); }); }
    res.redirect('/groups/' + groupId);
  });
});
app.get('/groups/:id', auth, (req, res) => {
  db.get("SELECT * FROM groups_table WHERE id=? AND teacher_id=?", [req.params.id, req.session.user.id], (err, group) => {
    if (!group) return res.redirect('/groups');
    db.all("SELECT users.* FROM group_students JOIN users ON group_students.student_id=users.id WHERE group_students.group_id=?", [req.params.id], (err, students) => {
      db.all("SELECT DISTINCT lessons.date_time, lessons.topic, lessons.status, lessons.id FROM lessons WHERE lessons.student_id IN (SELECT student_id FROM group_students WHERE group_id=?) AND lessons.teacher_id=? ORDER BY lessons.date_time DESC LIMIT 20", [req.params.id, req.session.user.id], (err, lessons) => {
        db.get("SELECT AVG(grade) as avg FROM lessons WHERE student_id IN (SELECT student_id FROM group_students WHERE group_id=?) AND teacher_id=? AND status='done' AND grade>0", [req.params.id, req.session.user.id], (err, avg) => {
          db.get("SELECT COUNT(DISTINCT date_time) as cnt FROM lessons WHERE student_id IN (SELECT student_id FROM group_students WHERE group_id=?) AND teacher_id=? AND status='done'", [req.params.id, req.session.user.id], (err, done) => {
            db.get("SELECT COUNT(DISTINCT date_time) as cnt FROM lessons WHERE student_id IN (SELECT student_id FROM group_students WHERE group_id=?) AND teacher_id=?", [req.params.id, req.session.user.id], (err, total) => {
              const totalCnt = total?.cnt||0; const doneCnt = done?.cnt||0; const attendance = totalCnt>0 ? Math.round(doneCnt/totalCnt*100) : 0;
              db.all("SELECT id, name FROM users WHERE role='student'", (err, allStudents) => { res.render('teacher/group-card', { user: req.session.user, group, students: students||[], lessons: lessons||[], avgGrade: avg?.avg||0, attendance, totalLessons: totalCnt, allStudents: allStudents||[] }); });
            });
          });
        });
      });
    });
  });
});
app.post('/groups/:id/add-student', auth, (req, res) => { db.run("INSERT OR IGNORE INTO group_students (group_id, student_id) VALUES (?,?)", [req.params.id, req.body.student_id], () => res.redirect('/groups/'+req.params.id)); });
app.get('/groups/delete/:id', auth, (req, res) => { db.run("DELETE FROM groups_table WHERE id=? AND teacher_id=?", [req.params.id, req.session.user.id], () => res.redirect('/groups')); });
app.get('/groups/:id/complete', auth, (req, res) => { db.run("UPDATE groups_table SET status='completed' WHERE id=? AND teacher_id=?", [req.params.id, req.session.user.id], () => res.redirect('/groups')); });
app.post('/groups/:id/add-lesson', auth, (req, res) => { const { date_time, topic, price, duration, link } = req.body; db.all("SELECT student_id FROM group_students WHERE group_id=?", [req.params.id], (err, students) => { students.forEach(s => { db.run("INSERT INTO lessons (teacher_id,student_id,date_time,price,topic,duration,link,is_group) VALUES (?,?,?,?,?,?,?,1)", [req.session.user.id, s.student_id, date_time, price, topic, duration||60, link||'']); }); res.redirect('/groups/'+req.params.id); }); });

// КАЛЕНДАРЬ
app.get('/calendar', auth, (req, res) => { db.all('SELECT lessons.*, users.name as student_name FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.teacher_id=? ORDER BY lessons.date_time', [req.session.user.id], (err, lessons) => { db.all("SELECT id, name FROM users WHERE role='student'", (err, students) => res.render('teacher/calendar', { user: req.session.user, lessons: lessons||[], students: students||[] })); }); });
app.get('/calendar/add', auth, (req, res) => { db.all("SELECT id, name FROM users WHERE role='student'", (err, students) => { res.render('teacher/calendar-add', { user: req.session.user, students: students||[], preselected: req.query.student_id||'' }); }); });
app.post('/calendar/add', auth, (req, res) => { const { student_id, date_time, price, topic, duration, link, repeat, repeat_count } = req.body; const count = parseInt(repeat_count)||1; for (let i=0; i<count; i++) { let dt = new Date(date_time); dt.setDate(dt.getDate()+i*(parseInt(repeat)||0)); db.run('INSERT INTO lessons (teacher_id,student_id,date_time,price,topic,duration,link) VALUES (?,?,?,?,?,?,?)', [req.session.user.id, student_id, dt.toISOString().slice(0,16), price, i===0?(topic||''):'', duration||60, link||'']); } res.redirect('/calendar'); });
app.post('/calendar/edit', auth, (req, res) => { const { id, date_time, price, status, topic } = req.body; db.run('UPDATE lessons SET date_time=?,price=?,status=?,topic=? WHERE id=? AND teacher_id=?', [date_time, price, status, topic||'', id, req.session.user.id], () => { if (status==='paid') { db.get('SELECT * FROM lessons WHERE id=?', [id], (err, l) => { if (l&&l.status!=='paid') db.run("INSERT INTO payments (teacher_id,student_id,amount,date,type,description) VALUES (?,?,?,?,?,?)", [req.session.user.id, l.student_id, l.price, new Date().toISOString().slice(0,10), 'income', 'Оплата урока']); }); } res.redirect('/calendar'); }); });
app.get('/calendar/delete/:id', auth, (req, res) => { db.run('DELETE FROM lessons WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], () => res.redirect('/calendar')); });
app.get('/calendar/conduct/:id', auth, (req, res) => { db.get("SELECT lessons.*, users.name as student_name FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.id=? AND lessons.teacher_id=?", [req.params.id, req.session.user.id], (err, lesson) => { if (!lesson) return res.redirect('/dashboard'); db.run('UPDATE lessons SET status=? WHERE id=? AND teacher_id=?', ['done', req.params.id, req.session.user.id], () => { if (lesson.status !== 'paid') db.run("INSERT INTO payments (teacher_id,student_id,amount,date,type,description) VALUES (?,?,?,?,?,?)", [req.session.user.id, lesson.student_id, lesson.price, new Date().toISOString().slice(0,10), 'income', 'Оплата урока']); res.redirect('/journal/'+req.params.id); }); }); });
app.get('/calendar/status/:id/:status', auth, (req, res) => { db.get('SELECT * FROM lessons WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], (err, l) => { if (!l) return res.redirect('/dashboard'); if (req.params.status==='paid'&&l.status==='paid') return res.redirect('/dashboard'); db.run('UPDATE lessons SET status=? WHERE id=? AND teacher_id=?', [req.params.status, req.params.id, req.session.user.id], () => { if (req.params.status==='paid') db.run("INSERT INTO payments (teacher_id,student_id,amount,date,type,description) VALUES (?,?,?,?,?,?)", [req.session.user.id, l.student_id, l.price, new Date().toISOString().slice(0,10), 'income', 'Оплата урока']); res.redirect('/dashboard'); }); }); });
app.get('/calendar/edit-date/:id', auth, (req, res) => { db.run('UPDATE lessons SET date_time=? WHERE id=? AND teacher_id=?', [req.query.date, req.params.id, req.session.user.id], () => res.redirect('/dashboard')); });
app.get('/calendar/copy/:id', auth, (req, res) => { db.get('SELECT * FROM lessons WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], (err, l) => { if (!l) return res.redirect('/calendar'); db.run('INSERT INTO lessons (teacher_id,student_id,date_time,price,topic,duration,link) VALUES (?,?,?,?,?,?,?)', [req.session.user.id, l.student_id, l.date_time, l.price, l.topic, l.duration, l.link], () => res.redirect('/calendar')); }); });

// ЖУРНАЛ
app.get('/journal/:lessonId', auth, (req, res) => { db.get("SELECT lessons.*, users.name as student_name FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.id=? AND lessons.teacher_id=?", [req.params.lessonId, req.session.user.id], (err, lesson) => { if (!lesson) return res.redirect('/dashboard'); db.all("SELECT * FROM templates WHERE teacher_id=?", [req.session.user.id], (err, templates) => res.render('teacher/lesson-journal', { user: req.session.user, lesson, templates: templates||[] })); }); });
app.post('/journal/:lessonId', auth, upload.array('files', 10), (req, res) => { const { topic, homework, lesson_notes, student_mood, plan_next, grade, teacher_comment, save_template } = req.body; let files = []; if (req.files) files = req.files.map(f => '/uploads/'+f.filename); const materials = files.join(','); db.run("UPDATE lessons SET topic=?,homework=?,lesson_notes=?,student_mood=?,plan_next=?,grade=?,teacher_comment=?,materials=?,status='done' WHERE id=? AND teacher_id=?", [topic||'',homework||'',lesson_notes||'',student_mood||3,plan_next||'',grade||0,teacher_comment||'',materials,req.params.lessonId,req.session.user.id], () => { if (save_template) { db.run("INSERT INTO templates (teacher_id, name, content) VALUES (?,?,?)", [req.session.user.id, topic||'Шаблон', JSON.stringify({topic,homework,lesson_notes,plan_next})]); } res.redirect('/dashboard'); }); });
app.post('/journal/draft/:lessonId', auth, (req, res) => { db.run("UPDATE lessons SET draft=? WHERE id=? AND teacher_id=?", [req.body.draft, req.params.lessonId, req.session.user.id], () => res.json({ok:true})); });

// ОСТАЛЬНЫЕ МАРШРУТЫ
app.get('/templates', auth, (req, res) => { db.all("SELECT * FROM templates WHERE teacher_id=?", [req.session.user.id], (err, templates) => res.render('teacher/templates', { user: req.session.user, templates: templates||[] })); });
app.get('/templates/delete/:id', auth, (req, res) => { db.run('DELETE FROM templates WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], () => res.redirect('/templates')); });
app.get('/finances', auth, (req, res) => { db.get("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE teacher_id=? AND type='income'", [req.session.user.id], (err, inc) => { db.get("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE teacher_id=? AND type='expense'", [req.session.user.id], (err, exp) => { db.all("SELECT * FROM payments WHERE teacher_id=? ORDER BY date DESC LIMIT 100", [req.session.user.id], (err, fin) => res.render('teacher/finances', { user: req.session.user, totalIncome: inc?.total||0, totalExpense: exp?.total||0, finances: fin||[] })); }); }); });
app.post('/finances/add', auth, (req, res) => { const { type, amount, description, date, category } = req.body; db.run("INSERT INTO payments (teacher_id,student_id,amount,date,type,description,category) VALUES (?,?,?,?,?,?,?)", [req.session.user.id, null, amount, date, type, description||'', category||''], () => res.redirect('/finances')); });
app.get('/finances/delete/:id', auth, (req, res) => { db.run('DELETE FROM payments WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], () => res.redirect('/finances')); });
app.get('/export', auth, (req, res) => { const month = req.query.month || new Date().toISOString().slice(0,7); db.all("SELECT * FROM payments WHERE teacher_id=? AND date LIKE ?", [req.session.user.id, month+'%'], (err, rows) => { let csv = '\uFEFFДата;Тип;Сумма\n'; let it=0,et=0; (rows||[]).forEach(d=>{ csv+=[d.date,d.type==='income'?'Доход':'Расход',d.amount].join(';')+'\n'; if(d.type==='income') it+=+d.amount; else et+=+d.amount; }); csv+=`\nДоходы;;${it}\nРасходы;;${et}\nБаланс;;${it-et}`; res.setHeader('Content-Type','text/csv;charset=utf-8'); res.setHeader('Content-Disposition','attachment;filename=report_'+month+'.csv'); res.send('\uFEFF'+csv); }); });
app.get('/receipts', auth, (req, res) => { db.all("SELECT * FROM users WHERE role='student'", (err, students) => { db.all("SELECT receipts.*, users.name as student_name FROM receipts JOIN users ON receipts.student_id=users.id WHERE receipts.teacher_id=?", [req.session.user.id], (err, receipts) => res.render('teacher/receipts', { user: req.session.user, students: students||[], receipts: receipts||[] })); }); });
app.post('/receipts/add', auth, (req, res) => { db.get("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE teacher_id=? AND student_id=? AND type='income' AND date LIKE ?", [req.session.user.id, req.body.student_id, req.body.month+'%'], (err, data) => { db.run('INSERT INTO receipts (teacher_id,student_id,created_at,month,total) VALUES (?,?,?,?,?)', [req.session.user.id, req.body.student_id, new Date().toISOString().slice(0,10), req.body.month, data?.total||0], () => res.redirect('/receipts')); }); });
app.get('/subscriptions', auth, (req, res) => { db.all("SELECT subscriptions.*, users.name as student_name FROM subscriptions JOIN users ON subscriptions.student_id=users.id WHERE subscriptions.teacher_id=? AND subscriptions.status='active'", [req.session.user.id], (err, active) => { db.all("SELECT id, name FROM users WHERE role='student'", (err, students) => res.render('teacher/subscriptions', { user: req.session.user, active: active||[], students: students||[] })); }); });
app.post('/subscriptions/add', auth, (req, res) => { const { student_id, lessons_total, start_date } = req.body; db.run("INSERT INTO subscriptions (teacher_id,student_id,lessons_total,lessons_left,start_date,end_date,status) VALUES (?,?,?,?,?,?,'active')", [req.session.user.id, student_id, lessons_total, lessons_total, start_date, start_date], () => res.redirect('/subscriptions')); });
app.get('/subscriptions/use/:id', auth, (req, res) => { db.get('SELECT * FROM subscriptions WHERE id=?', [req.params.id], (err, sub) => { if (sub && sub.lessons_left>0) { const left = sub.lessons_left-1; db.run('UPDATE subscriptions SET lessons_left=?,status=? WHERE id=?', [left, left===0?'ended':'active', req.params.id]); } res.redirect('/subscriptions'); }); });
app.get('/library', auth, (req, res) => { const folder = req.query.folder || 'all'; let q = "SELECT * FROM library WHERE teacher_id=?"; let p = [req.session.user.id]; if (folder!=='all') { q+=" AND folder=?"; p.push(folder); } q+=" ORDER BY created_at DESC"; db.all(q, p, (err, items) => db.all("SELECT DISTINCT folder FROM library WHERE teacher_id=?", [req.session.user.id], (err, folders) => res.render('teacher/library', { user: req.session.user, items: items||[], folders: folders||[], currentFolder: folder }))); });
app.post('/library/add', auth, upload.single('file'), (req, res) => { const { folder, title, description } = req.body; const file = req.file ? '/uploads/'+req.file.filename : null; db.run('INSERT INTO library (teacher_id,folder,title,file_url,description) VALUES (?,?,?,?,?)', [req.session.user.id, folder||'Общая', title, file, description||''], () => res.redirect('/library')); });
app.get('/library/delete/:id', auth, (req, res) => { db.run('DELETE FROM library WHERE id=? AND teacher_id=?', [req.params.id, req.session.user.id], () => res.redirect('/library')); });
app.get('/analytics', auth, (req, res) => { const uid = req.session.user.id; db.all("SELECT strftime('%Y-%m', date_time) as month, COUNT(*) as cnt, SUM(price) as total FROM lessons WHERE teacher_id=? AND status='done' GROUP BY month ORDER BY month DESC LIMIT 12", [uid], (err, incomeData) => { db.all("SELECT strftime('%Y-%m', date) as month, COUNT(*) as cnt FROM payments WHERE teacher_id=? AND type='income' GROUP BY month ORDER BY month DESC LIMIT 12", [uid], (err, payData) => { db.all("SELECT users.name, COUNT(*) as cnt, AVG(grade) as avg, SUM(price) as total FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.teacher_id=? AND lessons.status='done' GROUP BY lessons.student_id ORDER BY total DESC LIMIT 10", [uid], (err, topStudents) => { db.get("SELECT COUNT(*) as cnt FROM users WHERE role='student' AND status='active'", (err, active) => { db.get("SELECT COUNT(*) as cnt FROM lessons WHERE teacher_id=? AND status='done' AND date_time LIKE ?", [uid, new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'%'], (err, thisMonth) => { res.render('teacher/analytics', { user: req.session.user, incomeData: incomeData||[], payData: payData||[], topStudents: topStudents||[], activeStudents: active?.cnt||0, thisMonthLessons: thisMonth?.cnt||0 }); }); }); }); }); }); });
app.get('/compare', auth, (req, res) => { db.all("SELECT id, name FROM users WHERE role='student'", (err, students) => { const ids = req.query.ids ? req.query.ids.split(',') : []; if (ids.length < 2) return res.render('teacher/compare', { user: req.session.user, students: students||[], selected: [], data: null }); let q = "SELECT users.name, COUNT(*) as cnt, AVG(grade) as avg, SUM(price) as total FROM lessons JOIN users ON lessons.student_id=users.id WHERE lessons.teacher_id=? AND lessons.student_id IN ("+ids.map(()=>'?').join(',')+") AND lessons.status='done' GROUP BY lessons.student_id"; db.all(q, [req.session.user.id, ...ids], (err, data) => res.render('teacher/compare', { user: req.session.user, students: students||[], selected: ids, data: data||[] })); }); });
app.get('/backup', auth, (req, res) => { const data = {}; const tables = ['users','lessons','payments','homeworks','subscriptions','library','receipts','notes','goals','templates','tags','student_tags','groups_table','group_students']; let done = 0; tables.forEach(t => { db.all("SELECT * FROM "+t, (err, rows) => { data[t]=rows; done++; if (done===tables.length) { res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition','attachment;filename=backup.json'); res.send(JSON.stringify(data,null,2)); } }); }); });
app.get('/api/students', auth, (req, res) => { db.all("SELECT * FROM users WHERE role='student'", (err, rows) => res.json(rows)); });
app.get('/api/lessons', auth, (req, res) => { db.all("SELECT * FROM lessons WHERE teacher_id=?", [req.session.user.id], (err, rows) => res.json(rows)); });
app.get('/api/finances', auth, (req, res) => { db.all("SELECT * FROM payments WHERE teacher_id=?", [req.session.user.id], (err, rows) => res.json(rows)); });
app.get('/settings', auth, (req, res) => res.render('teacher/settings', { user: req.session.user, success: null }));
app.post('/settings', auth, (req, res) => { const { name, email, password, currency } = req.body; if (password) db.run('UPDATE users SET name=?,email=?,password=?,currency=? WHERE id=?', [name, email, bcrypt.hashSync(password,10), currency||'BYN', req.session.user.id], () => { req.session.user.name=name; req.session.user.currency=currency; res.render('teacher/settings', { user: req.session.user, success: 'Сохранено!' }); }); else db.run('UPDATE users SET name=?,email=?,currency=? WHERE id=?', [name, email, currency||'BYN', req.session.user.id], () => { req.session.user.name=name; req.session.user.currency=currency; res.render('teacher/settings', { user: req.session.user, success: 'Сохранено!' }); }); });

app.listen(PORT, () => { console.log('Журнал: http://localhost:'+PORT); db.get("SELECT * FROM users WHERE role='teacher'", (err, t) => { if (!t) db.run("INSERT INTO users (email,password,name,tariff) VALUES (?,?,?,?)", ['teacher@mail.com', bcrypt.hashSync('12345',10), 'Репетитор', 'premium']); }); });