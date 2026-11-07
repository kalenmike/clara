import { defineConfig } from 'vitepress'
import { withSidebar } from 'vitepress-sidebar'

const vitePressOptions = {
  title: 'Clara Documentation',
  rewrites(id) {
    if (id.endsWith('README.md')) {
      return id.replace(/README\.md$/, 'index.md')
    }
    return id
  },
}

const vitePressSidebarOptions = {
  // If your files are in a subfolder like 'docs', set this to '/docs'
  // If your files are at the root of your repo, set this to '/'
  documentRootPath: '/',
  scanStartPath: '',
  resolvePath: '/',
  useFolderTitleFromIndexFile: true,
  useFolderLinkFromIndexFile: true,
}

export default defineConfig(withSidebar(vitePressOptions, vitePressSidebarOptions))
