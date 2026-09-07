const db = require('../db/connection');
const { publicId } = require('../utils/ids');
const passwords = require('../utils/passwords');
const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../config/permissions');

async function seedTestData() {
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)');
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions (key) VALUES (?)');
  const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');
  const getPermId = db.prepare('SELECT id FROM permissions WHERE key = ?');
  const linkRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const roleName of Object.values(ROLES)) insertRole.run(roleName);
  for (const key of Object.values(PERMISSIONS)) insertPermission.run(key);
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = getRoleId.get(roleName).id;
    for (const key of perms) linkRolePerm.run(roleId, getPermId.get(key).id);
  }

  const password = 'TestPass!2026';
  const hash = await passwords.hash(password);
  const adminHash = await passwords.hash('BootstrapPass!123');

  db.prepare(`
    INSERT INTO users (public_id, school_id, username, email, password_hash, status)
    VALUES (?, NULL, 'admin', ?, ?, 'active')
  `).run(publicId('usr'), 'admin@test.local', adminHash);
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES ((SELECT id FROM users WHERE email = ?), ?)')
    .run('admin@test.local', getRoleId.get(ROLES.PLATFORM_ADMIN).id);

  function makeSchool(name, status, endsInDays) {
    const endsAt = new Date(Date.now() + endsInDays * 24 * 60 * 60 * 1000).toISOString();
    const schoolId = db.prepare('INSERT INTO schools (public_id, name, status, subscription_ends_at) VALUES (?, ?, ?, ?)')
      .run(publicId('sch'), name, status, endsAt).lastInsertRowid;
    db.prepare('INSERT INTO subscriptions (school_id, plan, status, ends_at) VALUES (?, \'standard\', ?, ?)')
      .run(schoolId, status, endsAt);
    return schoolId;
  }

  function makeUser(schoolId, username, email, roleName) {
    const userId = db.prepare(`
      INSERT INTO users (public_id, school_id, username, email, password_hash, status) VALUES (?, ?, ?, ?, ?, 'active')
    `).run(publicId('usr'), schoolId, username, email, hash).lastInsertRowid;
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, getRoleId.get(roleName).id);
    return userId;
  }

  function makeMinimalSchoolData(schoolId, prefix) {
    const classId = db.prepare('INSERT INTO classes (school_id, name, education_level) VALUES (?, ?, ?)')
      .run(schoolId, 'Form 1', 'secondary').lastInsertRowid;
    const subjectId = db.prepare('INSERT INTO subjects (school_id, name) VALUES (?, ?)')
      .run(schoolId, 'Mathematics').lastInsertRowid;
    const studentId = db.prepare(`
      INSERT INTO students (public_id, school_id, admission_no, first_name, last_name, class_id, gender)
      VALUES (?, ?, ?, 'Test', 'Student', ?, 'female')
    `).run(publicId('stu'), schoolId, `${prefix}-001`, classId).lastInsertRowid;
    db.prepare(`
      INSERT INTO academic_records (school_id, student_id, subject_id, term, year, score, grade)
      VALUES (?, ?, ?, 'Term 1', 2026, 72, 'B')
    `).run(schoolId, studentId, subjectId);
    const feeId = db.prepare(`
      INSERT INTO fees (public_id, school_id, student_id, term, year, amount_due) VALUES (?, ?, ?, 'Term 1', 2026, 100000)
    `).run(publicId('fee'), schoolId, studentId).lastInsertRowid;
    return { classId, subjectId, studentId, feeId };
  }

  const schoolA = makeSchool('Test School A', 'active', 300);
  makeUser(schoolA, 'sed_a', 'sed@testschool-a.demo', ROLES.SED);
  makeUser(schoolA, 'headteacher_a', 'headteacher@testschool-a.demo', ROLES.HEAD_TEACHER);
  makeUser(schoolA, 'accountant_a', 'accountant@testschool-a.demo', ROLES.ACCOUNTANT);
  makeMinimalSchoolData(schoolA, 'TSA');

  const schoolB = makeSchool('Test School B', 'active', 300);
  makeUser(schoolB, 'sed_b', 'sed@testschool-b.demo', ROLES.SED);
  makeUser(schoolB, 'headteacher_b', 'headteacher@testschool-b.demo', ROLES.HEAD_TEACHER);
  makeUser(schoolB, 'accountant_b', 'accountant@testschool-b.demo', ROLES.ACCOUNTANT);
  makeMinimalSchoolData(schoolB, 'TSB');

  const expiredSchool = makeSchool('Expired Test School', 'expired', -30);
  makeUser(expiredSchool, 'accountant_exp', 'accountant@expiredschool.demo', ROLES.ACCOUNTANT);
  makeMinimalSchoolData(expiredSchool, 'EXP');
}

module.exports = { seedTestData };
