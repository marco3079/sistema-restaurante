// Pix "copia e cola" (BR Code, padrão EMV do Banco Central), gerado a partir da chave Pix do restaurante.
// O código leva a chave, o valor e uma identificação da cobrança. O sistema não fala com o banco:
// quem confirma que o Pix caiu é o garçom, olhando o aplicativo ou o comprovante do cliente.

function campo(id: string, valor: string): string {
  return id + String(valor.length).padStart(2, '0') + valor;
}

// Só letras sem acento, números e espaço, em maiúsculas (o que os aplicativos de banco aceitam sem erro).
function simples(texto: string, maximo: number): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, maximo);
}

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no fim do código.
function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function gerarPixCopiaECola(dados: {
  chave: string;
  nome: string;
  cidade: string;
  valor: number;
  identificador: string;
}): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', dados.chave.trim());
  const identificador = dados.identificador.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const semCrc =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('54', dados.valor.toFixed(2)) +
    campo('58', 'BR') +
    campo('59', simples(dados.nome, 25) || 'RESTAURANTE') +
    campo('60', simples(dados.cidade, 15) || 'BRASIL') +
    campo('62', campo('05', identificador)) +
    '6304';
  return semCrc + crc16(semCrc);
}
