import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validateQuery } from '../middleware/validate';
import { validateBody } from '../middleware/validate';
import {
  emailPasswordLoginSchema,
  emailPasswordSignupSchema,
  googleCallbackQuerySchema,
} from '../schemas/auth.schema';

const router = Router();

router.get('/google', authController.googleAuth);
router.get('/google/callback', validateQuery(googleCallbackQuerySchema), authController.googleCallback);
router.get('/config', authController.getAuthConfig);
router.post('/signup', validateBody(emailPasswordSignupSchema), authController.signupWithPassword);
router.post('/login', validateBody(emailPasswordLoginSchema), authController.loginWithPassword);
router.get('/me', requireAuth, authController.getMe);
router.post('/logout', authController.logout);

export const authRoutes = router;
