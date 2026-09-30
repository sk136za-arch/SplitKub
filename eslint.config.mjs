import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: ["next-env.d.ts", ".next/**"] },
  ...nextVitals,
  ...nextTypescript,
];
export default eslintConfig;
