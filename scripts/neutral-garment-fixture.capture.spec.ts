import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const fixtureDir = path.join(root, ".agent-state/neutral-garment-fixture");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#222b38;color:#e2e8f0;font:18px sans-serif"><div style="position:absolute;top:20px;left:24px">Authored CC0 navy shirt and jeans · canonical indexed arrays<br><div style="display:flex;width:1200px;justify-content:space-around;margin-top:10px"><span>Standing at ease</span><span>Both arms raised</span></div></div><script type="module">
import * as T from '/node_modules/three/build/three.module.js';
const meta=await (await fetch('/fixture/fixture.json')).json();
const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(1440,1100);renderer.setPixelRatio(1);renderer.setClearColor(0x222b38);document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.add(new T.HemisphereLight(0xdceaff,0x63615a,2.3));const light=new T.DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(light);
const camera=new T.PerspectiveCamera(32,1440/1100,.01,100);camera.position.set(0,1.4,5.8);camera.lookAt(0,1.1,0);
async function array(d){const b=await(await fetch('/fixture/'+d.file)).arrayBuffer();return new globalThis[d.type](b)}
for(let n=0;n<meta.poses.length;n++){const group=new T.Group();group.position.x=n===0?-.7:.7;scene.add(group);const pose=meta.poses[n];for(let i=0;i<meta.parts.length;i++){const p=meta.parts[i],pp=pose.parts[i];const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(await array(pp.positions),3));g.setAttribute('normal',new T.BufferAttribute(await array(pp.normals),3));g.setAttribute('uv',new T.BufferAttribute(await array(p.arrays.uvs),2));g.setIndex(new T.BufferAttribute(await array(p.arrays.index),1));let map=null;if(p.textureUrl){map=await new T.TextureLoader().loadAsync('/fixture/'+p.textureUrl);map.colorSpace=T.SRGBColorSpace;}group.add(new T.Mesh(g,new T.MeshStandardMaterial({color:p.role==='body'?0xc5a18c:0xffffff,map,roughness:.83,side:T.DoubleSide})));}}
const floor=new T.Mesh(new T.PlaneGeometry(8,6),new T.MeshStandardMaterial({color:0x485462,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;scene.add(floor);renderer.render(scene,camera);window.fixtureReady={renderer:renderer.getContext().getParameter(renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),poses:meta.poses.map(p=>p.name),audio:'no audio nodes or media'};
</script></body></html>`;

test("paired authored garment poses, silent Metal capture", async ({ page }, testInfo) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    const file = req.url?.startsWith("/fixture/")
      ? path.join(fixtureDir, req.url.slice(9))
      : path.join(root, req.url ?? "");
    try {
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".json")
            ? "application/json"
            : file.endsWith(".webp")
              ? "image/webp"
              : "application/octet-stream",
      );
      res.end(fs.readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const addr = server.address() as { port: number };
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`http://127.0.0.1:${addr.port}/`);
    await page.waitForFunction(() =>
      Boolean((window as unknown as { fixtureReady?: unknown }).fixtureReady),
    );
    const proof = await page.evaluate(
      () => (window as unknown as { fixtureReady: unknown }).fixtureReady,
    );
    expect(JSON.stringify(proof)).toMatch(/Apple|Metal/);
    expect(await page.locator("audio,video").count()).toBe(0);
    await page.screenshot({ path: path.join(fixtureDir, "two-pose-metal.png") });
    fs.writeFileSync(
      path.join(fixtureDir, "capture-receipt.json"),
      JSON.stringify({ proof, project: testInfo.project.name }, null, 2),
    );
  } finally {
    server.close();
  }
});
