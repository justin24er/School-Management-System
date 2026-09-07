require('dotenv').config();
const db = require('./connection');
const { publicId } = require('../utils/ids');
const passwords = require('../utils/passwords');
const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../config/permissions');

async function main() {
  // ---- Roles & permissions (idempotent) --------------------------------
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)');
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions (key) VALUES (?)');
  const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');
  const getPermId = db.prepare('SELECT id FROM permissions WHERE key = ?');
  const linkRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const roleName of Object.values(ROLES)) insertRole.run(roleName);
  for (const key of Object.values(PERMISSIONS)) insertPermission.run(key);
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = getRoleId.get(roleName).id;
    for (const key of perms) {
      const permId = getPermId.get(key).id;
      linkRolePerm.run(roleId, permId);
    }
  }
  console.log('Roles and permissions seeded.');

  // ---- Bootstrap platform admin (only if none exists) -------------------
  const adminRoleId = getRoleId.get(ROLES.PLATFORM_ADMIN).id;
  const existingAdmin = db.prepare(`
    SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_id = ? LIMIT 1
  `).get(adminRoleId);

  if (!existingAdmin && process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    const hash = await passwords.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD);
    const userPublicId = publicId('usr');
    const info = db.prepare(`
      INSERT INTO users (public_id, school_id, username, email, password_hash, status)
      VALUES (?, NULL, 'platform_admin', ?, ?, 'active')
    `).run(userPublicId, process.env.BOOTSTRAP_ADMIN_EMAIL, hash);
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, adminRoleId);
    console.log(`Bootstrap Platform Admin created: ${process.env.BOOTSTRAP_ADMIN_EMAIL}`);
    console.log('IMPORTANT: remove BOOTSTRAP_ADMIN_* from .env after first login in a real deployment.');
  } else {
    console.log('Platform Admin already exists or bootstrap credentials not set — skipping.');
  }

  // ---- Demo data (two schools, to also demonstrate tenant isolation) ---
  if (process.env.NODE_ENV === 'production') {
    console.log('NODE_ENV=production — skipping demo data seed.');
    return;
  }

  const existingDemo = db.prepare("SELECT id FROM schools WHERE name = 'Uwezo Secondary School (Demo)'").get();
  if (existingDemo) {
    console.log('Demo data already present — skipping.');
    return;
  }

  const demoPassword = 'DemoPass!2026';
  const demoHash = await passwords.hash(demoPassword);

  function createSchool(name, statusDaysFromNow) {
    const schoolPublicId = publicId('sch');
    const endsAt = new Date(Date.now() + statusDaysFromNow * 24 * 60 * 60 * 1000).toISOString();
    const info = db.prepare(`
      INSERT INTO schools (public_id, name, status, subscription_ends_at) VALUES (?, ?, 'active', ?)
    `).run(schoolPublicId, name, endsAt);
    const schoolId = info.lastInsertRowid;
    db.prepare(`INSERT INTO subscriptions (school_id, plan, status, ends_at) VALUES (?, 'standard', 'active', ?)`)
      .run(schoolId, endsAt);
    return schoolId;
  }

  function createUser(schoolId, username, email, roleName) {
    const userPublicId = publicId('usr');
    const info = db.prepare(`
      INSERT INTO users (public_id, school_id, username, email, password_hash, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(userPublicId, schoolId, username, email, demoHash);
    const roleId = getRoleId.get(roleName).id;
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, roleId);
    return info.lastInsertRowid;
  }

  function seedSchoolData(schoolId, prefix) {
    const catIds = {};
    const cats = [['Water', 'resource'], ['Electricity', 'resource'], ['Maintenance', 'resource'],
      ['Supplies', 'operational'], ['Infrastructure', 'infrastructure']];
    for (const [name, kind] of cats) {
      const info = db.prepare('INSERT INTO expense_categories (school_id, name, kind) VALUES (?, ?, ?)')
        .run(schoolId, name, kind);
      catIds[name] = info.lastInsertRowid;
    }

    const classNames = ['Form 1', 'Form 2', 'Form 3', 'Form 4'];
    const classIds = classNames.map(name =>
      db.prepare('INSERT INTO classes (school_id, name, education_level) VALUES (?, ?, ?)')
        .run(schoolId, name, 'secondary').lastInsertRowid
    );

    const subjectNames = ['Mathematics', 'English', 'Kiswahili', 'Biology', 'Physics', 'Chemistry', 'Geography'];
    const subjectIds = subjectNames.map(name =>
      db.prepare('INSERT INTO subjects (school_id, name) VALUES (?, ?)').run(schoolId, name).lastInsertRowid
    );

    const firstNames = ['Asha', 'Juma', 'Neema', 'Baraka', 'Zawadi', 'Imani', 'Rehema', 'Elias', 'Faraja', 'Winnie'];
    const lastNames = ['Mushi', 'Kileo', 'Mrema', 'Shirima', 'Ndosi', 'Mwakalinga', 'Kway', 'Mbwana'];

    const studentIds = [];
    for (let i = 0; i < 40; i += 1) {
      const first = firstNames[i % firstNames.length];
      const last = lastNames[(i * 3) % lastNames.length];
      const classId = classIds[i % classIds.length];
      const admissionNo = `${prefix}-${1000 + i}`;
      const gender = i % 2 === 0 ? 'female' : 'male';
      const sPublicId = publicId('stu');
      const info = db.prepare(`
        INSERT INTO students (public_id, school_id, admission_no, first_name, last_name, class_id, gender)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sPublicId, schoolId, admissionNo, first, `${last}${i}`, classId, gender);
      studentIds.push(info.lastInsertRowid);
    }

    const staffPositions = ['Teacher', 'Teacher', 'Teacher', 'Lab Technician', 'Librarian', 'Groundskeeper'];
    for (let i = 0; i < 12; i += 1) {
      const position = staffPositions[i % staffPositions.length];
      db.prepare(`
        INSERT INTO staff (public_id, school_id, first_name, last_name, position, is_teacher, hired_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).run(publicId('stf'), schoolId, firstNames[i % firstNames.length], lastNames[i % lastNames.length],
        position, position === 'Teacher' ? 1 : 0);
    }

    // Academic records for the current and previous year.
    const years = [new Date().getFullYear() - 1, new Date().getFullYear()];
    for (const year of years) {
      for (const studentRowId of studentIds) {
        for (const subjectRowId of subjectIds) {
          const score = Math.round(45 + Math.random() * 50);
          const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
          db.prepare(`
            INSERT INTO academic_records (school_id, student_id, subject_id, term, year, score, grade)
            VALUES (?, ?, ?, 'Term 1', ?, ?, ?)
          `).run(schoolId, studentRowId, subjectRowId, year, score, grade);
        }
      }
    }

    // Fees and payments for the current year.
    const year = new Date().getFullYear();
    for (const studentRowId of studentIds) {
      const amountDue = 450000; // TZS-scale figure, illustrative
      const feePublicId = publicId('fee');
      const info = db.prepare(`
        INSERT INTO fees (public_id, school_id, student_id, term, year, amount_due) VALUES (?, ?, ?, 'Term 1', ?, ?)
      `).run(feePublicId, schoolId, studentRowId, year, amountDue);
      const feeId = info.lastInsertRowid;

      const paid = Math.random() > 0.25 ? amountDue : Math.round(amountDue * Math.random());
      if (paid > 0) {
        db.prepare(`
          INSERT INTO payments (public_id, school_id, fee_id, student_id, amount, method)
          VALUES (?, ?, ?, ?, ?, 'mobile_money')
        `).run(publicId('pay'), schoolId, feeId, studentRowId, paid);
        const status = paid >= amountDue ? 'paid' : 'partial';
        db.prepare('UPDATE fees SET amount_paid = ?, status = ? WHERE id = ?').run(paid, status, feeId);
      }
    }

    // Infrastructure projects and expenses across several months.
    const projectId = db.prepare(`
      INSERT INTO infrastructure_projects (public_id, school_id, name, status, budget, start_date)
      VALUES (?, ?, 'New classroom block', 'active', 20000000, date('now', '-4 months'))
    `).run(publicId('prj'), schoolId).lastInsertRowid;

    for (let m = 0; m < 6; m += 1) {
      const dateStr = `date('now', '-${m} months')`;
      for (const [catName, amountRange] of [['Water', [80000, 150000]], ['Electricity', [200000, 400000]],
        ['Maintenance', [100000, 300000]], ['Supplies', [150000, 500000]]]) {
        const amount = Math.round(amountRange[0] + Math.random() * (amountRange[1] - amountRange[0]));
        db.prepare(`
          INSERT INTO expenses (public_id, school_id, category_id, description, amount, incurred_on)
          VALUES (?, ?, ?, ?, ?, ${dateStr})
        `).run(publicId('exp'), schoolId, catIds[catName], `${catName} — monthly`, amount);
      }
      if (m % 2 === 0) {
        const amount = Math.round(500000 + Math.random() * 1500000);
        db.prepare(`
          INSERT INTO expenses (public_id, school_id, category_id, project_id, description, amount, incurred_on)
          VALUES (?, ?, ?, ?, 'Classroom block construction materials', ?, ${dateStr})
        `).run(publicId('exp'), schoolId, catIds['Infrastructure'], projectId, amount);
      }
    }
  }

  const schoolAId = createSchool('Uwezo Secondary School (Demo)', 300);
  createUser(schoolAId, 'sed_uwezo', 'sed@uwezo.demo', ROLES.SED);
  createUser(schoolAId, 'headteacher_uwezo', 'headteacher@uwezo.demo', ROLES.HEAD_TEACHER);
  createUser(schoolAId, 'accountant_uwezo', 'accountant@uwezo.demo', ROLES.ACCOUNTANT);
  seedSchoolData(schoolAId, 'UWZ');

  const schoolBId = createSchool('Amani Primary School (Demo)', 12); // deliberately expiring soon, for testing that state
  createUser(schoolBId, 'sed_amani', 'sed@amani.demo', ROLES.SED);
  createUser(schoolBId, 'headteacher_amani', 'headteacher@amani.demo', ROLES.HEAD_TEACHER);
  createUser(schoolBId, 'accountant_amani', 'accountant@amani.demo', ROLES.ACCOUNTANT);
  seedSchoolData(schoolBId, 'AMN');

  console.log('Demo schools seeded: Uwezo Secondary School (Demo), Amani Primary School (Demo).');
  console.log(`Demo password for all demo school accounts: ${demoPassword}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
