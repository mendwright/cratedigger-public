// Vite raw-asset imports (used to bundle the Pi receiver script as a string).
declare module '*?raw' {
  const source: string
  export default source
}
