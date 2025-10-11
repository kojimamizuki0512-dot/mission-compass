export function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.afterLoginRedirect = req.originalUrl || '/';
    return res.redirect('/login');
  }
  return next();
}

export function requirePaidAccess(req, res, next) {
  if (!req.session.hasPaid) {
    return res.redirect('/checkout');
  }
  return next();
}
