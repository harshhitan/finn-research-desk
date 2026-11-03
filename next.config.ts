import type { NextConfig } from "next";
import path from 'node:path';

const nextConfig: NextConfig = {
  serverExternalPackages:['pg'],
  webpack(config,{webpack}){
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,path.resolve('lib/node-environment.mjs')));
    return config;
  },
};

export default nextConfig;
