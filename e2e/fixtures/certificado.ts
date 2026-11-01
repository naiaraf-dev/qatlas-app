import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  X509Certificate,
} from 'node:crypto';

/**
 * Un certificado de prueba, generado en cada corrida: nada queda versionado. Node no sabe crear uno, y
 * sumar una dependencia para esto no se justifica. Solo para tests: nunca lo usa la app.
 */
export interface CertificadoDePrueba {
  key: string;
  cert: string;
  /** SHA-256 del certificado, para comparar con lo que ve quien se conecta. */
  huella: string;
}

function der(etiqueta: number, ...contenido: Buffer[]): Buffer {
  const cuerpo = Buffer.concat(contenido);
  const largo = cuerpo.length;
  let cabecera: Buffer;
  if (largo < 0x80) cabecera = Buffer.from([largo]);
  else if (largo < 0x100) cabecera = Buffer.from([0x81, largo]);
  else cabecera = Buffer.from([0x82, largo >> 8, largo & 0xff]);
  return Buffer.concat([Buffer.from([etiqueta]), cabecera, cuerpo]);
}

const secuencia = (...contenido: Buffer[]) => der(0x30, ...contenido);

function oid(texto: string): Buffer {
  const [a = 0, b = 0, ...resto] = texto.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const valor of resto) {
    const grupo = [valor & 0x7f];
    for (let v = valor >> 7; v > 0; v >>= 7) grupo.unshift((v & 0x7f) | 0x80);
    bytes.push(...grupo);
  }
  return der(0x06, Buffer.from(bytes));
}

const utcTime = (fecha: Date) =>
  der(0x17, Buffer.from(`${fecha.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));

const FIRMA_ECDSA_SHA256 = secuencia(oid('1.2.840.10045.4.3.2'));

export function generarCertificado(hosts: readonly string[]): CertificadoDePrueba {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const nombre = secuencia(
    der(0x31, secuencia(oid('2.5.4.3'), der(0x0c, Buffer.from('Certificado de prueba de QAtlas')))),
  );
  const ahora = Date.now();
  const alternativos = hosts.map((host) => der(0x82, Buffer.from(host)));
  const extensiones = der(
    0xa3,
    secuencia(secuencia(oid('2.5.29.17'), der(0x04, secuencia(...alternativos)))),
  );
  const firmado = secuencia(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(
      0x02,
      Buffer.from([1, ...createHash('sha256').update(String(ahora)).digest().subarray(0, 8)]),
    ),
    FIRMA_ECDSA_SHA256,
    nombre,
    secuencia(utcTime(new Date(ahora - 60_000)), utcTime(new Date(ahora + 3_600_000))),
    nombre,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensiones,
  );
  const firma = sign(
    'sha256',
    firmado,
    createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' })),
  );
  const certificado = secuencia(firmado, FIRMA_ECDSA_SHA256, der(0x03, Buffer.from([0]), firma));
  const lineas = certificado.toString('base64').match(/.{1,64}/g) ?? [];
  const cert = `-----BEGIN CERTIFICATE-----\n${lineas.join('\n')}\n-----END CERTIFICATE-----\n`;
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert,
    huella: new X509Certificate(cert).fingerprint256,
  };
}
