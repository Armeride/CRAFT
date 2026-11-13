import { useTranslation } from 'react-i18next';
export function DraftConflict({ serverText, busy, resolve }: { serverText: string; busy: boolean; resolve: (mode: 'server' | 'fork') => void }) {
  const { t } = useTranslation();
  return <section className="draft-conflict" role="alert"><h3>{t('conflict.title')}</h3><p>{t('conflict.hint')}</p><label>{t('conflict.server')}<textarea readOnly value={serverText}/></label><div className="modal-controls"><button className="secondary-button" disabled={busy} onClick={() => resolve('server')}>{t('conflict.useServer')}</button><button className="primary-button" disabled={busy} onClick={() => resolve('fork')}>{t('conflict.fork')}</button></div></section>;
}
