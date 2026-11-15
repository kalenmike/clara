import type { Config } from '@docusaurus/types'
import type { Options as PresetOptions } from '@docusaurus/preset-classic'

const url = process.env.DOCS_URL ?? 'https://clara.example.com'
const baseUrl = process.env.DOCS_BASE_URL ?? '/'

const config: Config = {
  title: 'Clara',
  tagline: 'A secure web client for OpenCode sessions',
  favicon: 'img/favicon.png',
  url,
  baseUrl,
  organizationName: 'clara',
  projectName: 'clara',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  clientModules: ['./src/clientModules/d3Transition.ts'],
  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        docsRouteBasePath: ['/guide', '/internals'],
        docsDir: ['guide', '../../docs'],
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],
  presets: [
    [
      'classic',
      {
        docs: {
          path: 'guide',
          routeBasePath: '/guide',
          sidebarPath: './sidebars.guide.ts',
        },
        blog: false,
        pages: {
          path: 'src/pages',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies PresetOptions,
    ],
  ],
  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'internals',
        path: '../../docs',
        routeBasePath: '/internals',
        sidebarPath: './sidebars.internals.ts',
        exclude: ['records/**'],
      },
    ],
  ],
  themeConfig: {
    image: 'img/clara-mark.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Clara',
      logo: {
        alt: 'Clara',
        src: 'img/clara-mark.png',
      },
      items: [
        { to: '/guide/', label: 'User guide', position: 'left' },
        { to: '/internals/', label: 'Developer docs', position: 'left' },
        { type: 'search', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Use Clara',
          items: [
            { label: 'Getting started', to: '/guide/getting-started' },
            { label: 'Connect a device', to: '/guide/connect' },
            { label: 'Troubleshooting', to: '/guide/troubleshooting' },
          ],
        },
        {
          title: 'Host Clara',
          items: [
            { label: 'Self-hosting overview', to: '/guide/self-hosting/' },
            { label: 'Local install', to: '/guide/self-hosting/local' },
          ],
        },
        {
          title: 'Develop',
          items: [
            { label: 'Internal documentation', to: '/internals/' },
            { label: 'Architecture', to: '/internals/architecture/overview' },
            { label: 'Feature specs', to: '/internals/features/capabilities' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Clara.`,
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: false,
      },
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
  } satisfies Config['themeConfig'],
}

export default config
