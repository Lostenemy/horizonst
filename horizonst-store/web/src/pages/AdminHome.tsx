export default function AdminHome() {
  return (
    <section className="panel">
      <h1>Panel admin</h1>
      <p>Placeholder útil protegido por rol admin. El panel operativo completo queda fuera de esta fase.</p>
      <div className="cards compact">
        {['Distribuidores', 'Documentos', 'Presupuestos', 'Auditoría'].map((section) => (
          <article className="card" key={section}><h2>{section}</h2><p className="muted">Sección prevista para próximas fases.</p></article>
        ))}
      </div>
    </section>
  );
}
