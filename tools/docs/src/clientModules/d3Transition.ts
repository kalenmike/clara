// Mermaid 12 uses selection.transition() for flowchart tooltips but does not
// import d3-transition in the chunk that binds them. Importing it here patches
// d3-selection for the Mermaid bundle as well.
// See https://github.com/meta/docusaurus/issues/12938.
import 'd3-transition'
