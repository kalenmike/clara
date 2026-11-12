import type { ReactNode } from 'react'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import styles from './index.module.css'

export default function Home(): ReactNode {
  return (
    <Layout
      title="Clara documentation"
      description="Learn how to use Clara, connect a device, and host the hub service."
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Clara documentation</p>
          <h1 className={styles.title}>
            Your OpenCode sessions,
            <br />
            securely in the browser.
          </h1>
          <p className={styles.lead}>
            Clara is a browser and home-screen client for one OpenCode server. Pair a device, open a
            project, and work with your agents from anywhere through an end-to-end encrypted
            connection.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} to="/guide/getting-started">
              I have a Clara link
            </Link>
            <Link className={styles.secondary} to="/guide/self-hosting/">
              I want to host Clara
            </Link>
          </div>
        </section>

        <section className={styles.cards} aria-label="Documentation sections">
          <article className={styles.card}>
            <h2>Start using Clara</h2>
            <p>
              Pair your phone or browser, find your projects, and learn the session and chat basics.
            </p>
            <Link to="/guide/getting-started">Open the user guide →</Link>
          </article>
          <article className={styles.card}>
            <h2>Host your own hub</h2>
            <p>
              Run the hub service and web client with Docker or Node, connect OpenCode, and pair
              your devices.
            </p>
            <Link to="/guide/self-hosting/">Read the self-hosting guide →</Link>
          </article>
          <article className={styles.card}>
            <h2>Work on Clara</h2>
            <p>
              Architecture, feature specs, and implementation notes for contributors and agents.
            </p>
            <Link to="/internals/">Open the developer docs →</Link>
          </article>
        </section>
      </main>
    </Layout>
  )
}
