const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/register
// No OTP - account is created immediately.
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, confirm_password, date_of_birth, country, id_number } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Full name, email and password are required' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!date_of_birth) {
      return res.status(400).json({ error: 'Date of birth is required' });
    }

    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Please enter a valid date of birth' });
    }

    // Campaign owners handle real money and must be able to enter an
    // agreement, so registration is restricted to adults. Checked
    // server-side so it can't be bypassed from the browser.
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;

    if (age < 18) {
      return res.status(400).json({ error: 'You must be at least 18 years old to create an account' });
    }
    if (age > 120) {
      return res.status(400).json({ error: 'Please enter a valid date of birth' });
    }

    // National ID is required for Kenyan users only.
    const userCountry = country || 'KE';
    let cleanIdNumber = null;
    if (userCountry === 'KE') {
      if (!id_number || !String(id_number).trim()) {
        return res.status(400).json({ error: 'ID number is required for Kenyan users' });
      }
      cleanIdNumber = String(id_number).replace(/\D/g, '');
      if (cleanIdNumber.length < 6 || cleanIdNumber.length > 10) {
        return res.status(400).json({ error: 'Please enter a valid Kenyan ID number' });
      }
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        full_name,
        email: email.toLowerCase(),
        password_hash,
        date_of_birth,
        country: userCountry,
        id_number: cleanIdNumber,
        role: 'owner'
      })
      .select()
      .single();

    if (error) throw error;

    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

module.exports = router;
