/** The shared live/miniature UV pigment field. Texture lifetime belongs to the installing renderer. */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  ShaderChunk,
  UnsignedByteType,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { FacialHairGreyError, type ResolvedFacialHairGrey } from "../surface/facialHairGrey.ts";

/** Check the actual renderer rather than truncating caller data to an invented core size limit. */
export function checkFacialHairGreySize(
  grey: ResolvedFacialHairGrey,
  maxTextureSize: number,
): void {
  if (grey.width > maxTextureSize || grey.height > maxTextureSize)
    throw new FacialHairGreyError(
      `facial grey mask ${grey.width}x${grey.height} exceeds renderer texture size ${maxTextureSize}`,
    );
}

/** Copy the exact caller view, without transferring or detaching its storage. */
export function facialHairGreyTexture(grey: ResolvedFacialHairGrey): DataTexture {
  const map = new DataTexture(
    Uint8Array.from(grey.data),
    grey.width,
    grey.height,
    RedFormat,
    UnsignedByteType,
  );
  map.colorSpace = NoColorSpace;
  map.flipY = true;
  map.unpackAlignment = 1;
  map.wrapS = map.wrapT = ClampToEdgeWrapping;
  map.minFilter = map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}

export function facialHairGreyUniforms(grey: ResolvedFacialHairGrey, map: DataTexture) {
  return {
    hkGreyMap: { value: map },
    hkGreyAmount: { value: grey.amount },
    hkGreyTint: { value: new Vector3(...grey.tint) },
  };
}

/** Mix before source RGB multiplication; leave source alpha and every coverage operation intact. */
export function patchFacialHairGrey(
  shader: WebGLProgramParametersWithUniforms,
  sheen = false,
): void {
  const common = "#include <common>";
  const map = "#include <map_fragment>";
  if (!shader.fragmentShader.includes(common) || !shader.fragmentShader.includes(map))
    throw new FacialHairGreyError("facial grey material chunks moved");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      common,
      `${common}\nuniform sampler2D hkGreyMap;\nuniform float hkGreyAmount;\nuniform vec3 hkGreyTint;`,
    )
    .replace(
      map,
      `
#ifdef USE_MAP
  diffuseColor.rgb = mix(diffuseColor.rgb, hkGreyTint, hkGreyAmount * texture2D(hkGreyMap, vMapUv).r);
#endif
${map}`,
    );
  if (sheen) {
    const chunk = ShaderChunk.lights_physical_fragment;
    const line = "material.sheenColor = sheenColor;";
    if (
      !chunk.includes(line) ||
      !shader.fragmentShader.includes("#include <lights_physical_fragment>")
    )
      throw new FacialHairGreyError("facial grey sheen chunk moved");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_fragment>",
      chunk.replace(
        line,
        `${line}
#ifdef USE_MAP
  material.sheenColor = mix(material.sheenColor, hkGreyTint, hkGreyAmount * texture2D(hkGreyMap, vMapUv).r);
#endif`,
      ),
    );
  }
}
