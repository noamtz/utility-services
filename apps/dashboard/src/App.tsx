const ARCHITECTURE_URL = "https://github.com/noamtz/utility-services/wiki/Architecture";

export function App() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="product-title">
        <p className="eyebrow">Application foundation</p>
        <h1 id="product-title">Reusable Utility Services</h1>
        <p className="status">
          The shared TypeScript, REST, and infrastructure foundation is ready for the first utility
          slices.
        </p>
        <a className="documentation-link" href={ARCHITECTURE_URL}>
          Read the canonical architecture
        </a>
      </section>
    </main>
  );
}
