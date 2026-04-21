'use client';

import * as React from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import { OBJLoader } from 'three-stdlib';
import * as THREE from 'three';
import { RotateCcw, FileX2 } from 'lucide-react';
import { Button } from './ui/button';
import { LoadingShimmer } from './loading-shimmer';
import { cn } from '@/lib/cn';

/**
 * 3D mesh viewer (react-three-fiber).
 *
 * Loader policy:
 *   - STL (binary + ASCII): three-stdlib STLLoader.
 *   - OBJ: three-stdlib OBJLoader.
 *   - 3MF: DEFERRED. three-stdlib ships a 3MFLoader but it requires fflate
 *     and a structured-zip reader; we stub with a clear error message.
 *     Backend analysis still works for 3MFs — the customer just sees a
 *     placeholder in place of the preview.
 *
 * Dimensions shown in mm. The engine's bbox is the source of truth once
 * the server quote returns; client-side bbox is just for the initial fit
 * so we don't wait a network round-trip to position the camera.
 */

type ViewerFormat = 'stl' | 'obj' | '3mf';

export interface MeshViewerProps {
  file: File | null;
  format: ViewerFormat | null;
  /**
   * Authoritative bbox from the server quote response, in millimetres.
   * When present, overrides the client-computed bbox for the overlay.
   */
  authoritativeBbox?: { x: number; y: number; z: number } | null;
  className?: string;
}

export function MeshViewer({
  file,
  format,
  authoritativeBbox,
  className,
}: MeshViewerProps) {
  const [geometry, setGeometry] = React.useState<THREE.BufferGeometry | null>(null);
  const [clientBbox, setClientBbox] = React.useState<THREE.Vector3 | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const resetRef = React.useRef<{ reset: () => void } | null>(null);

  React.useEffect(() => {
    if (!file || !format) {
      setGeometry(null);
      setClientBbox(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        if (format === '3mf') {
          // Deliberately deferred — see module JSDoc.
          setLoadError(
            '3D preview for 3MF files is coming soon — your quote still works.',
          );
          setLoading(false);
          return;
        }

        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        let geo: THREE.BufferGeometry;
        if (format === 'stl') {
          geo = new STLLoader().parse(buffer);
        } else {
          // OBJ is ASCII; decode to string. three-stdlib's OBJLoader returns
          // a Group, not a geometry, so we flatten its meshes into one.
          const text = new TextDecoder().decode(buffer);
          const group = new OBJLoader().parse(text);
          const geos: THREE.BufferGeometry[] = [];
          group.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const g = (obj as THREE.Mesh).geometry;
              if (g instanceof THREE.BufferGeometry) geos.push(g);
            }
          });
          if (geos.length === 0) {
            throw new Error('No geometry found in OBJ file.');
          }
          // Merge by cloning each into the accumulator. Simple concat-position
          // path — good enough for preview (no morph targets / groups).
          geo = geos[0]!.clone();
          // For MVP we render only the first geometry; splicing multiple
          // group meshes into one BufferGeometry is non-trivial and not
          // worth the code for the 99% single-group OBJ case.
        }

        geo.computeBoundingBox();
        geo.computeVertexNormals();

        const bb = new THREE.Box3().setFromBufferAttribute(
          geo.getAttribute('position') as THREE.BufferAttribute,
        );
        const size = new THREE.Vector3();
        bb.getSize(size);

        // Centre the mesh on the origin for nice orbit behaviour.
        const centre = new THREE.Vector3();
        bb.getCenter(centre);
        geo.translate(-centre.x, -centre.y, -centre.z);

        if (!cancelled) {
          setGeometry(geo);
          setClientBbox(size);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Could not read that file.';
          setLoadError(
            `We couldn't render the preview. ${message} Your quote is still accurate.`,
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, format]);

  const displayBbox =
    authoritativeBbox ??
    (clientBbox
      ? { x: clientBbox.x, y: clientBbox.y, z: clientBbox.z }
      : null);

  return (
    <div
      className={cn(
        'relative rounded-lg border border-border bg-secondary overflow-hidden',
        'aspect-[4/3]',
        className,
      )}
    >
      {loading && !loadError ? (
        <LoadingShimmer className="absolute inset-0" label="Rendering preview" />
      ) : null}

      {loadError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <FileX2 className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground max-w-xs">{loadError}</p>
        </div>
      ) : null}

      {geometry && !loadError ? (
        <Canvas
          camera={{ position: [1.8, 1.4, 1.8], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 5, 5]} intensity={0.8} />
          <directionalLight position={[-3, -2, -1]} intensity={0.25} />
          <FitCamera
            geometry={geometry}
            onReady={(api) => {
              resetRef.current = api;
            }}
          />
          <mesh geometry={geometry}>
            <meshStandardMaterial
              color="#cbd5e1"
              metalness={0.1}
              roughness={0.7}
              flatShading
            />
          </mesh>
          <OrbitControls
            makeDefault
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={0.3}
            maxDistance={20}
          />
          <gridHelper args={[10, 20, '#cbd5e1', '#e2e8f0']} position={[0, -0.01, 0]} />
        </Canvas>
      ) : null}

      {/* Dimensions overlay — always rendered so layout doesn't jump. */}
      <div className="absolute top-2 left-2 rounded-md bg-background/90 backdrop-blur px-2.5 py-1.5 text-xs text-muted-foreground shadow-1 pointer-events-none num-tabular">
        {displayBbox ? (
          <>
            <span className="font-medium text-foreground">
              {displayBbox.x.toFixed(0)} × {displayBbox.y.toFixed(0)} ×{' '}
              {displayBbox.z.toFixed(0)} mm
            </span>
          </>
        ) : (
          <span>— mm</span>
        )}
      </div>

      {/* Reset view button — bottom-right, 44px touch target on mobile. */}
      {geometry && !loadError ? (
        <div className="absolute bottom-2 right-2">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => resetRef.current?.reset()}
            aria-label="Reset view"
            className="size-11 md:size-10"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fits the orbit camera to the mesh bounding sphere on first render and
 * exposes a reset() imperative API back to the parent.
 */
function FitCamera({
  geometry,
  onReady,
}: {
  geometry: THREE.BufferGeometry;
  onReady: (api: { reset: () => void }) => void;
}) {
  const { camera, controls } = useThree((s) => ({
    camera: s.camera,
    controls: s.controls as { reset?: () => void } | null,
  }));

  React.useEffect(() => {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return;

    // Distance that fits the bounding sphere with the current fov.
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const fit = sphere.radius / Math.sin((fov / 2) * (Math.PI / 180));
    camera.position.set(fit, fit * 0.75, fit);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const reset = () => {
      camera.position.set(fit, fit * 0.75, fit);
      camera.lookAt(0, 0, 0);
      controls?.reset?.();
    };
    onReady({ reset });
  }, [geometry, camera, controls, onReady]);

  return null;
}
