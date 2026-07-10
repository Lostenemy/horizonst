import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <section className="hero">
      <p className="eyebrow">HorizonST Store</p>
      <h1>Compra B2B para soluciones HorizonST</h1>
      <p>
        Catálogo privado para clientes y distribuidores: packs de hardware, planes web y solicitudes de
        presupuesto con trazabilidad comercial.
      </p>
      <div className="actions">
        <Link className="btn" to="/catalog">Ver catálogo</Link>
        <Link className="btn secondary" to="/saas-plans">Planes web</Link>
        <Link className="btn ghost" to="/login">Login</Link>
        <Link className="btn ghost" to="/register">Registro cliente</Link>
      </div>
    </section>
  );
}
