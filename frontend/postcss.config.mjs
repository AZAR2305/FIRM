// Explicit config so a stray postcss.config in a parent directory is never picked up.
export default { plugins: { "@tailwindcss/postcss": {} } };
