// auth routes: register, login, current user.
import { Router } from 'express';
import { validate } from '../../lib/http.js';
import { LoginBody, RegisterBody } from './schemas.js';
import { login, register, requireAuth } from './service.js';

export const router = Router({ mergeParams: true });

router.post('/register', validate(RegisterBody), async (req, res) => {
  res.status(201).json(await register(req.body));
});

router.post('/login', validate(LoginBody), async (req, res) => {
  res.json(await login(req.body));
});

router.get('/me', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});
