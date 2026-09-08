const express = require('express');
const Joi = require('joi');
const db = require('../db/connection');
const { publicId } = require('../utils/ids');
const auditService = require('../services/auditService');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireSchoolContext, enforceSubscriptionForWrites } = require('../middleware/tenant');
const { validateBody } = require('../utils/validate');
const { PERMISSIONS } = require('../config/permissions');

const router = express.Router();
router.use(requireAuth, requireSchoolContext, enforceSubscriptionForWrites);

function paginate(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// -----------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------
router.get('/students', requirePermission(PERMISSIONS.STUDENTS_READ), (req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const search = req.query.search ? `%${req.query.search}%` : null;
  const status = req.query.status || null;
  const classPublicId = req.query.classId || null;

  let where = 'WHERE s.school_id = ?';
  const params = [req.schoolId];
  if (search) {
    where += ' AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_no LIKE ?)';
    params.push(search, search, search);
  }
  if (status) { where += ' AND s.status = ?'; params.push(status); }
  if (classPublicId) { where += ' AND c.public_id = ?'; params.push(classPublicId); }

  const rows = db.prepare(`
    SELECT s.public_id, s.first_name, s.last_name, s.admission_no, s.status, s.gender,
           c.name AS class_name
    FROM students s LEFT JOIN classes c ON c.id = s.class_id
    ${where} ORDER BY s.last_name, s.first_name LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM students s LEFT JOIN classes c ON c.id = s.class_id ${where}
  `).get(...params).n;
  res.json({ data: rows, page, pageSize, total });
});

// Creating a student is allowed for Head Teacher (students.manage) OR
// Accountant (enrollment.manage) — requirePermission() requires ALL listed
// permissions, which is the wrong shape for an OR check, so this route
// checks the two permissions explicitly instead.
router.post('/students', (req, res, next) => {
  if (!req.user.permissions.has(PERMISSIONS.STUDENTS_MANAGE) && !req.user.permissions.has(PERMISSIONS.ENROLLMENT_MANAGE)) {
    auditService.record({
      actorUserId: req.user.id, schoolId: req.schoolId, action: 'authorization.denied',
      resourceType: 'students', result: 'denied', req,
    });
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  next();
}, validateBody(Joi.object({
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  admissionNo: Joi.string().trim().min(1).max(50).required(),
  classId: Joi.string().allow(null, '').optional(),
  gender: Joi.string().valid('female', 'male', 'other').optional(),
})), (req, res) => {
  const { firstName, lastName, admissionNo, classId, gender } = req.body;
  let classRowId = null;
  if (classId) {
    const classRow = db.prepare('SELECT id FROM classes WHERE public_id = ? AND school_id = ?').get(classId, req.schoolId);
    classRowId = classRow ? classRow.id : null;
  }
  const studentPublicId = publicId('stu');
  try {
    db.prepare(`
      INSERT INTO students (public_id, school_id, admission_no, first_name, last_name, class_id, gender)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(studentPublicId, req.schoolId, admissionNo, firstName, lastName, classRowId, gender || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A student with that admission number already exists.' });
    }
    throw e;
  }
  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'student.created',
    resourceType: 'student', resourceId: studentPublicId, newValue: { firstName, lastName, admissionNo },
  });
  res.status(201).json({ publicId: studentPublicId });
});

router.patch('/students/:publicId/status', requirePermission(PERMISSIONS.STUDENTS_MANAGE), validateBody(Joi.object({
  status: Joi.string().valid('active', 'inactive', 'graduated', 'withdrawn').required(),
})), (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE public_id = ? AND school_id = ?')
    .get(req.params.publicId, req.schoolId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  db.prepare('UPDATE students SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(req.body.status, student.id);

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'student.status_changed',
    resourceType: 'student', resourceId: student.public_id,
    previousValue: { status: student.status }, newValue: { status: req.body.status },
  });
  res.json({ message: 'Student status updated.' });
});

// -----------------------------------------------------------------------
// Classes & subjects (lightweight reference data used by other modules)
// -----------------------------------------------------------------------
router.get('/classes', requirePermission(PERMISSIONS.SCHOOL_READ), (req, res) => {
  res.json(db.prepare('SELECT public_id, name, education_level FROM classes WHERE school_id = ? ORDER BY name')
    .all(req.schoolId));
});

router.post('/classes', requirePermission(PERMISSIONS.ACADEMICS_MANAGE), validateBody(Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  educationLevel: Joi.string().valid('primary', 'secondary').required(),
})), (req, res) => {
  const classPublicId = publicId('cls');
  db.prepare('INSERT INTO classes (public_id, school_id, name, education_level) VALUES (?, ?, ?, ?)')
    .run(classPublicId, req.schoolId, req.body.name, req.body.educationLevel);
  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'class.created', newValue: req.body });
  res.status(201).json({ publicId: classPublicId });
});

router.get('/subjects', requirePermission(PERMISSIONS.SCHOOL_READ), (req, res) => {
  res.json(db.prepare('SELECT public_id, name FROM subjects WHERE school_id = ? ORDER BY name').all(req.schoolId));
});

router.post('/subjects', requirePermission(PERMISSIONS.ACADEMICS_MANAGE), validateBody(Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
})), (req, res) => {
  const subjectPublicId = publicId('sub');
  db.prepare('INSERT INTO subjects (public_id, school_id, name) VALUES (?, ?, ?)').run(subjectPublicId, req.schoolId, req.body.name);
  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'subject.created', newValue: req.body });
  res.status(201).json({ publicId: subjectPublicId });
});

// -----------------------------------------------------------------------
// Academic records
// -----------------------------------------------------------------------
router.get('/academic-records', requirePermission(PERMISSIONS.ACADEMICS_READ), (req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const rows = db.prepare(`
    SELECT ar.id, s.public_id AS student_id, s.first_name, s.last_name, sub.name AS subject,
           ar.term, ar.year, ar.score, ar.grade
    FROM academic_records ar
    JOIN students s ON s.id = ar.student_id
    JOIN subjects sub ON sub.id = ar.subject_id
    WHERE ar.school_id = ?
    ORDER BY ar.year DESC, ar.term DESC LIMIT ? OFFSET ?
  `).all(req.schoolId, pageSize, offset);
  res.json({ data: rows, page, pageSize });
});

router.post('/academic-records', requirePermission(PERMISSIONS.ACADEMICS_MANAGE), validateBody(Joi.object({
  studentId: Joi.string().required(),
  subjectId: Joi.string().required(),
  term: Joi.string().required(),
  year: Joi.number().integer().min(2000).max(2100).required(),
  score: Joi.number().min(0).max(100).required(),
  grade: Joi.string().max(5).allow('', null),
})), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE public_id = ? AND school_id = ?')
    .get(req.body.studentId, req.schoolId);
  const subject = db.prepare('SELECT id FROM subjects WHERE public_id = ? AND school_id = ?')
    .get(req.body.subjectId, req.schoolId);
  if (!student || !subject) return res.status(404).json({ error: 'Student or subject not found.' });

  db.prepare(`
    INSERT INTO academic_records (school_id, student_id, subject_id, term, year, score, grade, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.schoolId, student.id, subject.id, req.body.term, req.body.year, req.body.score, req.body.grade || null, req.user.id);

  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'academic_record.created', newValue: req.body });
  res.status(201).json({ message: 'Academic record saved.' });
});

// -----------------------------------------------------------------------
// Staff
// -----------------------------------------------------------------------
router.get('/staff', requirePermission(PERMISSIONS.STAFF_READ), (req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const rows = db.prepare(`
    SELECT public_id, first_name, last_name, position, is_teacher, status
    FROM staff WHERE school_id = ? ORDER BY last_name LIMIT ? OFFSET ?
  `).all(req.schoolId, pageSize, offset);
  res.json({ data: rows, page, pageSize });
});

router.post('/staff', requirePermission(PERMISSIONS.STAFF_MANAGE), validateBody(Joi.object({
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  position: Joi.string().trim().min(1).max(100).required(),
  isTeacher: Joi.boolean().default(false),
})), (req, res) => {
  const staffPublicId = publicId('stf');
  db.prepare(`
    INSERT INTO staff (public_id, school_id, first_name, last_name, position, is_teacher, hired_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).run(staffPublicId, req.schoolId, req.body.firstName, req.body.lastName, req.body.position, req.body.isTeacher ? 1 : 0);

  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'staff.created', resourceId: staffPublicId, newValue: req.body });
  res.status(201).json({ publicId: staffPublicId });
});

router.patch('/staff/:publicId/status', requirePermission(PERMISSIONS.STAFF_MANAGE), validateBody(Joi.object({
  status: Joi.string().valid('active', 'inactive').required(),
})), (req, res) => {
  // Deactivation, never deletion, for anyone tied to historical records
  // (spec section 13/72): staff who have left keep their record.
  const staff = db.prepare('SELECT * FROM staff WHERE public_id = ? AND school_id = ?')
    .get(req.params.publicId, req.schoolId);
  if (!staff) return res.status(404).json({ error: 'Staff record not found.' });

  db.prepare('UPDATE staff SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(req.body.status, staff.id);

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'staff.status_changed',
    resourceId: staff.public_id, previousValue: { status: staff.status }, newValue: { status: req.body.status },
  });
  res.json({ message: 'Staff record updated.' });
});

// -----------------------------------------------------------------------
// Fees & payments
// -----------------------------------------------------------------------
router.get('/fees', requirePermission(PERMISSIONS.FEES_READ), (req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const rows = db.prepare(`
    SELECT f.public_id, s.first_name, s.last_name, s.admission_no, f.term, f.year,
           f.amount_due, f.amount_paid, f.status
    FROM fees f JOIN students s ON s.id = f.student_id
    WHERE f.school_id = ? ORDER BY f.year DESC, f.term DESC LIMIT ? OFFSET ?
  `).all(req.schoolId, pageSize, offset);
  res.json({ data: rows, page, pageSize });
});

router.post('/fees', requirePermission(PERMISSIONS.FEES_MANAGE), validateBody(Joi.object({
  studentId: Joi.string().required(),
  term: Joi.string().required(),
  year: Joi.number().integer().min(2000).max(2100).required(),
  amountDue: Joi.number().positive().required(),
})), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE public_id = ? AND school_id = ?')
    .get(req.body.studentId, req.schoolId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const feePublicId = publicId('fee');
  db.prepare(`
    INSERT INTO fees (public_id, school_id, student_id, term, year, amount_due)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(feePublicId, req.schoolId, student.id, req.body.term, req.body.year, req.body.amountDue);

  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'fee.created', resourceId: feePublicId, newValue: req.body });
  res.status(201).json({ publicId: feePublicId });
});

router.post('/payments', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), validateBody(Joi.object({
  feeId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  method: Joi.string().valid('cash', 'bank', 'mobile_money', 'cheque').default('cash'),
})), (req, res) => {
  const fee = db.prepare('SELECT * FROM fees WHERE public_id = ? AND school_id = ?').get(req.body.feeId, req.schoolId);
  if (!fee) return res.status(404).json({ error: 'Fee record not found.' });

  const paymentPublicId = publicId('pay');
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (public_id, school_id, fee_id, student_id, amount, method, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(paymentPublicId, req.schoolId, fee.id, fee.student_id, req.body.amount, req.body.method, req.user.id);

    const newPaid = fee.amount_paid + req.body.amount;
    const newStatus = newPaid >= fee.amount_due ? 'paid' : (newPaid > 0 ? 'partial' : fee.status);
    db.prepare('UPDATE fees SET amount_paid = ?, status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
      .run(newPaid, newStatus, fee.id);
  });
  tx();

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'payment.recorded',
    resourceType: 'payment', resourceId: paymentPublicId, newValue: req.body,
  });
  res.status(201).json({ publicId: paymentPublicId });
});

// Payments are never deleted — a mistaken payment is reversed, preserving
// history (spec section 55/88: financial integrity, auditable corrections).
router.post('/payments/:publicId/reverse', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), validateBody(Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
})), (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE public_id = ? AND school_id = ?')
    .get(req.params.publicId, req.schoolId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.status === 'reversed') return res.status(409).json({ error: 'This payment has already been reversed.' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE payments SET status = ?, reversed_reason = ? WHERE id = ?')
      .run('reversed', req.body.reason, payment.id);
    const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(payment.fee_id);
    const newPaid = Math.max(0, fee.amount_paid - payment.amount);
    const newStatus = newPaid <= 0 ? 'unpaid' : (newPaid >= fee.amount_due ? 'paid' : 'partial');
    db.prepare('UPDATE fees SET amount_paid = ?, status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
      .run(newPaid, newStatus, fee.id);
  });
  tx();

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'payment.reversed',
    resourceType: 'payment', resourceId: payment.public_id, newValue: { reason: req.body.reason },
  });
  res.json({ message: 'Payment reversed.' });
});

// -----------------------------------------------------------------------
// Expense categories & expenses (also covers "resources")
// -----------------------------------------------------------------------
router.get('/expense-categories', requirePermission(PERMISSIONS.EXPENSES_READ), (req, res) => {
  res.json(db.prepare('SELECT public_id, name, kind FROM expense_categories WHERE school_id = ? ORDER BY name')
    .all(req.schoolId));
});

router.get('/expenses', requirePermission(PERMISSIONS.EXPENSES_READ), (req, res) => {
  const { page, pageSize, offset } = paginate(req);
  const kind = req.query.kind || null;
  let where = 'WHERE e.school_id = ?';
  const params = [req.schoolId];
  if (kind) { where += ' AND c.kind = ?'; params.push(kind); }

  const rows = db.prepare(`
    SELECT e.public_id, e.description, e.amount, e.status, e.incurred_on, c.name AS category, c.kind
    FROM expenses e JOIN expense_categories c ON c.id = e.category_id
    ${where} ORDER BY e.incurred_on DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  res.json({ data: rows, page, pageSize });
});

router.post('/expenses', requirePermission(PERMISSIONS.EXPENSES_MANAGE), validateBody(Joi.object({
  categoryId: Joi.string().required(),
  description: Joi.string().trim().min(1).max(300).required(),
  amount: Joi.number().positive().required(),
  incurredOn: Joi.string().isoDate().required(),
  projectId: Joi.string().allow(null, '').optional(),
})), (req, res) => {
  const category = db.prepare('SELECT id FROM expense_categories WHERE public_id = ? AND school_id = ?')
    .get(req.body.categoryId, req.schoolId);
  if (!category) return res.status(404).json({ error: 'Expense category not found.' });

  let projectRowId = null;
  if (req.body.projectId) {
    const project = db.prepare('SELECT id FROM infrastructure_projects WHERE public_id = ? AND school_id = ?')
      .get(req.body.projectId, req.schoolId);
    projectRowId = project ? project.id : null;
  }

  const expensePublicId = publicId('exp');
  db.prepare(`
    INSERT INTO expenses (public_id, school_id, category_id, project_id, description, amount, incurred_on, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(expensePublicId, req.schoolId, category.id, projectRowId, req.body.description, req.body.amount, req.body.incurredOn, req.user.id);

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'expense.created',
    resourceId: expensePublicId, newValue: req.body,
  });
  res.status(201).json({ publicId: expensePublicId });
});

// -----------------------------------------------------------------------
// Infrastructure projects
// -----------------------------------------------------------------------
router.get('/infrastructure-projects', requirePermission(PERMISSIONS.INFRASTRUCTURE_READ), (req, res) => {
  const rows = db.prepare(`
    SELECT p.public_id, p.name, p.status, p.budget, p.start_date, p.end_date,
           COALESCE(SUM(e.amount), 0) AS spent
    FROM infrastructure_projects p
    LEFT JOIN expenses e ON e.project_id = p.id AND e.status = 'recorded'
    WHERE p.school_id = ? GROUP BY p.id ORDER BY p.created_at DESC
  `).all(req.schoolId);
  res.json(rows);
});

router.post('/infrastructure-projects', requirePermission(PERMISSIONS.INFRASTRUCTURE_MANAGE), validateBody(Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  budget: Joi.number().min(0).required(),
  startDate: Joi.string().isoDate().allow(null, ''),
  endDate: Joi.string().isoDate().allow(null, ''),
})), (req, res) => {
  const projectPublicId = publicId('prj');
  db.prepare(`
    INSERT INTO infrastructure_projects (public_id, school_id, name, budget, start_date, end_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectPublicId, req.schoolId, req.body.name, req.body.budget, req.body.startDate || null, req.body.endDate || null, req.user.id);

  auditService.record({ actorUserId: req.user.id, schoolId: req.schoolId, action: 'infrastructure_project.created', resourceId: projectPublicId, newValue: req.body });
  res.status(201).json({ publicId: projectPublicId });
});

router.patch('/infrastructure-projects/:publicId/status', requirePermission(PERMISSIONS.INFRASTRUCTURE_MANAGE), validateBody(Joi.object({
  status: Joi.string().valid('planned', 'active', 'completed', 'on_hold').required(),
})), (req, res) => {
  const project = db.prepare('SELECT * FROM infrastructure_projects WHERE public_id = ? AND school_id = ?')
    .get(req.params.publicId, req.schoolId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  db.prepare('UPDATE infrastructure_projects SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(req.body.status, project.id);

  auditService.record({
    actorUserId: req.user.id, schoolId: req.schoolId, action: 'infrastructure_project.status_changed',
    resourceId: project.public_id, previousValue: { status: project.status }, newValue: { status: req.body.status },
  });
  res.json({ message: 'Project status updated.' });
});

module.exports = router;
