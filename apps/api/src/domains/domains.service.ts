import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveTxt } from 'dns/promises';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken } from '../common/utils';

export type VerifyMethod = 'DNS' | 'META' | 'FILE';

/**
 * Xác thực sở hữu domain (Zalo/Meta yêu cầu khi đăng ký OA hoặc app):
 * mỗi domain 1 mã duy nhất, đạt khi đúng 1 trong 3 cách:
 *  1. DNS   : TXT record tại domain có giá trị = mã
 *  2. META  : trang chủ có <meta name="chumchum-site-verification" content="<mã>">
 *  3. FILE  : file https://domain/<mã>.txt chứa mã
 */
@Injectable()
export class DomainsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.domainVerification.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async add(rawDomain: string) {
    const domain = this.normalize(rawDomain);
    const exists = await this.prisma.domainVerification.findUnique({ where: { domain } });
    if (exists) throw new BadRequestException('Domain này đã được thêm rồi');
    return this.prisma.domainVerification.create({
      data: { domain, verificationKey: `chumchum-verify-${randomToken(16)}` },
    });
  }

  async remove(id: string) {
    await this.ensure(id);
    await this.prisma.domainVerification.delete({ where: { id } });
    return { ok: true };
  }

  /** Chạy lại kiểm tra cả 3 cách; lưu kết quả whichever pass đầu tiên. */
  async check(id: string) {
    const record = await this.ensure(id);
    const attempts: { method: VerifyMethod; ok: boolean; detail: string }[] = [];

    // 1) DNS TXT
    try {
      const txt = await resolveTxt(record.domain).then((rows) => rows.flat());
      const ok = txt.some((v) => v.includes(record.verificationKey));
      attempts.push({ method: 'DNS', ok, detail: ok ? 'Tìm thấy TXT record' : `Chưa thấy TXT có giá trị ${record.verificationKey}` });
      if (ok) return this.markVerified(record.id, 'DNS');
    } catch {
      attempts.push({ method: 'DNS', ok: false, detail: 'Không truy vấn được DNS của domain' });
    }

    // 2) Meta tag ở trang chủ + 3) File /<key>.txt (thử https rồi http)
    const html = await this.fetchText(`https://${record.domain}/`, 5000) ?? await this.fetchText(`http://${record.domain}/`, 5000);
    const metaOk = !!html && html.includes(`name="chumchum-site-verification" content="${record.verificationKey}"`);
    attempts.push({
      method: 'META',
      ok: metaOk,
      detail: metaOk ? 'Thấy meta tag ở trang chủ' : 'Chưa thấy meta tag ở trang chủ',
    });

    const fileBody = await this.fetchText(`https://${record.domain}/${record.verificationKey}.txt`, 5000)
      ?? await this.fetchText(`http://${record.domain}/${record.verificationKey}.txt`, 5000);
    const fileOk = !!fileBody && fileBody.includes(record.verificationKey);
    attempts.push({
      method: 'FILE',
      ok: fileOk,
      detail: fileOk ? 'Thấy file xác thực' : `Chưa thấy file /${record.verificationKey}.txt`,
    });

    if (metaOk) return this.markVerified(record.id, 'META', attempts);
    if (fileOk) return this.markVerified(record.id, 'FILE', attempts);

    return { ...record, status: 'PENDING' as const, method: null, attempts };
  }

  /** Endpoint public cho nhà cung cấp (Zalo/Meta) hoặc kiểm tra nhanh: GET /domains/verify/<key> */
  async publicStatus(key: string) {
    const record = await this.prisma.domainVerification.findUnique({ where: { verificationKey: key } });
    if (!record) throw new NotFoundException('Mã xác thực không tồn tại');
    return { domain: record.domain, status: record.status, method: record.method, verifiedAt: record.verifiedAt };
  }

  private async markVerified(id: string, method: VerifyMethod, attempts?: { method: string; ok: boolean; detail: string }[]) {
    const updated = await this.prisma.domainVerification.update({
      where: { id },
      data: { status: 'VERIFIED', method, verifiedAt: new Date() },
    });
    return { ...updated, attempts };
  }

  private async ensure(id: string) {
    const record = await this.prisma.domainVerification.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Không tìm thấy domain');
    return record;
  }

  private normalize(raw: string): string {
    let domain = (raw ?? '').trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
      throw new BadRequestException('Domain không hợp lệ (vd: chumchumbakery.com)');
    }
    return domain;
  }

  private async fetchText(url: string, timeoutMs: number): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.text()).slice(0, 200_000);
    } catch {
      return null;
    }
  }
}
