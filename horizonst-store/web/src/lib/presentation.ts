import type { Role } from './types';

export const quoteStatusLabels = {
  draft: 'Borrador', submitted: 'Solicitud recibida', in_review: 'En revisión',
  sent: 'Propuesta enviada', accepted: 'Aceptado', rejected: 'Rechazado', cancelled: 'Cancelado'
} as const;

const labels: Record<string, string> = {
  ...quoteStatusLabels, active: 'Activo', pending: 'Pendiente', approved: 'Aprobado',
  needs_more_info: 'Falta información', suspended: 'Suspendido', closed: 'Cerrado',
  pending_email_verification: 'Pendiente de verificar email', replaced: 'Reemplazado',
  processing: 'En proceso', completed: 'Completado', confirmed: 'Confirmado', failed: 'Fallido',
  customer: 'Cliente', distributor: 'Distribuidor', admin: 'Administrador',
  cart_item_added: 'Artículo añadido al carrito', cart_item_updated: 'Cantidad del carrito actualizada',
  cart_item_removed: 'Artículo retirado del carrito', quote_submitted: 'Solicitud de presupuesto recibida',
  quote_status_changed: 'Estado de presupuesto actualizado', quote_accepted: 'Presupuesto aceptado',
  quote_rejected: 'Presupuesto rechazado', distributor_profile_updated: 'Perfil de distribuidor actualizado',
  distributor_document_uploaded: 'Documento de distribuidor recibido',
  distributor_validation_status_changed: 'Validación de distribuidor actualizada',
  order_created: 'Pedido creado', order_status_changed: 'Estado de pedido actualizado',
  product_created: 'Producto creado', product_updated: 'Producto actualizado', product_deactivated: 'Producto desactivado',
  saas_plan_created: 'Plan web creado', saas_plan_updated: 'Plan web actualizado', saas_plan_deactivated: 'Plan web desactivado',
  distributor_application_created: 'Solicitud de distribuidor recibida', customer_email_verified: 'Email de cliente verificado',
  customer_verification_email_resent: 'Verificación de email reenviada',
  distributor_document_approved: 'Documento aprobado', distributor_document_rejected: 'Documento rechazado',
  distributor_document_replaced: 'Documento reemplazado', distributor_document_status_changed: 'Estado de documento actualizado',
  distributor_document_downloaded: 'Documento descargado', admin_distributor_document_downloaded: 'Documento descargado por administración',
  distributor_resource_uploaded: 'Recurso recibido', distributor_resource_updated: 'Recurso actualizado',
  distributor_resource_archived: 'Recurso archivado', distributor_resource_downloaded: 'Recurso descargado',
  admin_distributor_resource_downloaded: 'Recurso descargado por administración',
  quote: 'Presupuesto', quote_item: 'Artículo de presupuesto', order: 'Pedido', product: 'Producto', saas_plan: 'Plan web',
  distributor_profile: 'Perfil distribuidor', distributor_document: 'Documento distribuidor', distributor_resource_document: 'Recurso distribuidor'
};
export const displayLabel = (code: string) => labels[code] ?? code;

export const quotesNavigation = (role: Role) => role === 'admin'
  ? { to: '/admin/quotes', label: 'Gestionar presupuestos' }
  : { to: '/quotes', label: 'Mis presupuestos' };

export const quoteDisplayName = (quote: { status: string; quote_number: string }) =>
  quote.status === 'draft' ? 'Borrador de presupuesto' : quote.quote_number;

// Separa solo el nombre; conserva íntegro el resto del snapshot comercial.
export const itemPresentation = (description: string) => {
  const separator = description.indexOf(':');
  return separator < 0 ? { name: description, details: '' }
    : { name: description.slice(0, separator), details: description.slice(separator + 1).trim() };
};

export function pageTitle(pathname: string, publicSite: boolean): string {
  const publicTitles: Record<string, string> = {
    '/': 'Supervisión en cámaras congeladoras', '/planes': 'Planes', '/info-faqs': 'Cómo funciona',
    '/privacidad': 'Privacidad', '/aviso-legal': 'Aviso legal', '/contacto': 'Contacto'
  };
  const storeTitles: Record<string, string> = {
    '/': 'Tienda B2B', '/catalog': 'Catálogo B2B', '/cart': 'Carrito', '/login': 'Acceso',
    '/register': 'Registro cliente', '/register-distributor': 'Registro distribuidor',
    '/dashboard': 'Mi área comercial', '/quotes': 'Mis presupuestos', '/orders': 'Mis pedidos',
    '/account': 'Mi cuenta', '/verify-email': 'Verificar email', '/forgot-password': 'Recuperar contraseña',
    '/reset-password': 'Nueva contraseña', '/admin': 'Resumen comercial', '/admin/quotes': 'Gestionar presupuestos',
    '/admin/orders': 'Gestionar pedidos', '/admin/distributors': 'Distribuidores', '/admin/customers': 'Clientes',
    '/admin/prereservations': 'Prerreservas', '/admin/audit': 'Auditoría',
    '/admin/catalog/products': 'Productos', '/admin/catalog/saas-plans': 'Planes web',
    '/admin/distributor-resources': 'Documentación distribuidores', '/distributor': 'Área distribuidor',
    '/distributor/profile': 'Perfil distribuidor', '/distributor/documents': 'Mis documentos',
    '/distributor/resources': 'Documentación HorizonST'
  };
  const title = (publicSite ? publicTitles : storeTitles)[pathname]
    ?? (publicSite && pathname.startsWith('/prerreserva/') ? 'Prerreserva'
      : pathname.startsWith('/admin/quotes/') ? 'Detalle de presupuesto'
      : pathname.startsWith('/admin/orders/') ? 'Detalle de pedido'
      : pathname.startsWith('/admin/distributors/') ? 'Detalle de distribuidor'
      : pathname.startsWith('/admin/prereservations/') ? 'Detalle de prerreserva' : 'Página no encontrada');
  return `${title} | ${publicSite ? 'HorizonST' : 'HorizonST Store'}`;
}
