import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import Account from './pages/Account';
import AdminAudit from './pages/admin/AdminAudit';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminDistributorDetail from './pages/admin/AdminDistributorDetail';
import AdminDistributors from './pages/admin/AdminDistributors';
import AdminProducts from './pages/admin/AdminProducts';
import AdminOrderDetail from './pages/admin/AdminOrderDetail';
import AdminOrders from './pages/admin/AdminOrders';
import AdminQuoteDetail from './pages/admin/AdminQuoteDetail';
import AdminQuotes from './pages/admin/AdminQuotes';
import AdminSaasPlans from './pages/admin/AdminSaasPlans';
import Cart from './pages/Cart';
import Catalog from './pages/Catalog';
import Dashboard from './pages/Dashboard';
import DistributorDocuments from './pages/DistributorDocuments';
import DistributorProfile from './pages/DistributorProfile';
import ForgotPassword from './pages/ForgotPassword';
import Home from './pages/Home';
import Login from './pages/Login';
import Quotes from './pages/Quotes';
import Orders from './pages/Orders';
import Register from './pages/Register';
import RegisterDistributor from './pages/RegisterDistributor';
import ResetPassword from './pages/ResetPassword';
import SaasPlans from './pages/SaasPlans';
import VerifyEmail from './pages/VerifyEmail';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register-distributor" element={<RegisterDistributor />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/saas-plans" element={<SaasPlans />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/account" element={<Account />} />
          <Route path="/cart" element={<Cart />} />
          <Route element={<RoleRoute roles={['customer', 'distributor']} />}>
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/orders" element={<Orders />} />
          </Route>

          <Route element={<RoleRoute roles={['distributor']} />}>
            <Route path="/distributor" element={<DistributorProfile />} />
            <Route path="/distributor/profile" element={<DistributorProfile />} />
            <Route path="/distributor/documents" element={<DistributorDocuments />} />
          </Route>

          <Route element={<RoleRoute roles={['admin']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/distributors" element={<AdminDistributors />} />
            <Route path="/admin/distributors/:id" element={<AdminDistributorDetail />} />
            <Route path="/admin/quotes" element={<AdminQuotes />} />
            <Route path="/admin/quotes/:id" element={<AdminQuoteDetail />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/catalog/products" element={<AdminProducts />} />
            <Route path="/admin/catalog/saas-plans" element={<AdminSaasPlans />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
