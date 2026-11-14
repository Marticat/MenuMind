import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';

type Policy = { id: string; label: string; impressions: number; additions: number; rate: number };
type Study = {
  dataSource: string;
  seeds: number[];
  stepsPerSeed: number;
  guestCount: number;
  dishCount: number;
  scenarios: { id: string; title: string; policies: Policy[] }[];
};
type Stats = {
  items: {
    mode: 'live' | 'demo';
    impressions: number;
    additions: number;
    observations: number;
    pending: number;
  }[];
};

export function PersonalizationEvidence({ refreshKey }: { refreshKey: string }) {
  const [study, setStudy] = useState<Study | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scenarioId, setScenarioId] = useState('personalized');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void Promise.all([api<Study>('/personalization/study'), api<Stats>('/personalization/stats')])
      .then(([experiment, counts]) => {
        if (!cancelled) {
          setStudy(experiment);
          setStats(counts);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, refresh]);
  const scenario = study?.scenarios.find((s) => s.id === scenarioId);
  return (
    <section
      className="account-panel personalization-evidence"
      aria-label="Проверка персонализации"
    >
      <h2>Что показывает персонализация</h2>
      <p>
        Сравнение ниже использует вымышленных гостей и реакции. Оно проверяет обучение алгоритма, но
        не доказывает рост реальных заказов.
      </p>
      {error && <p className="form-error">{error}</p>}
      {study && scenario && (
        <>
          <label className="product-field">
            Тестовый сценарий
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {study.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <p>
            {study.guestCount} тестовых профилей · {study.dishCount} блюд · {study.seeds.length}{' '}
            запуска по {study.stepsPerSeed} показов. Все способы выбора получают одинаковый поток
            гостей и условий реакции.
          </p>
          <table className="personalization-comparison">
            <caption>Смоделированные добавления в корзину</caption>
            <thead>
              <tr>
                <th scope="col">Способ выбора</th>
                <th scope="col">Добавления / показы</th>
                <th scope="col">Доля</th>
              </tr>
            </thead>
            <tbody>
              {scenario.policies.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.label}</th>
                  <td>
                    {p.additions} / {p.impressions}
                  </td>
                  <td>{(p.rate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            {scenario.id === 'no-effect'
              ? 'Когда тип описания не влияет на реакцию, все способы получают одинаковый результат.'
              : scenario.id === 'common-preference'
                ? 'Если всем подходит один вариант, общий вариант может быть эффективнее обучения с исследованием альтернатив.'
                : 'В этом сценарии симулятор задаёт разные предпочтения гостям. Алгоритм видит профиль и только реакцию на выбранный вариант; скрытые вероятности ему не передаются.'}
          </p>
          <details>
            <summary>Условия эксперимента</summary>
            <p>
              Вероятность тестового добавления: 65% для подходящего стиля и 15% для остальных. В
              сценарии без эффекта — 30% для любого стиля. Начальные состояния генератора:{' '}
              {study.seeds.join(', ')}. Каждый запуск начинает обучение с нуля. Используются
              шаблонные описания, без платных запросов к модели. Эти вероятности — предположения
              симулятора, а не данные ресторана.
            </p>
          </details>
        </>
      )}
      <h3>События вашего аккаунта</h3>
      <p>
        Кнопки выше записывают только тестовые события. Рабочие события поступают через интеграцию
        API. Добавление в корзину не означает покупку.
      </p>
      {stats && (
        <div className="personalization-event-counts">
          {(['demo', 'live'] as const).map((mode) => {
            const total = stats.items
              .filter((r) => r.mode === mode)
              .reduce(
                (sum, r) => ({
                  impressions: sum.impressions + r.impressions,
                  additions: sum.additions + r.additions,
                  pending: sum.pending + r.pending,
                }),
                { impressions: 0, additions: 0, pending: 0 },
              );
            return (
              <div key={mode}>
                <strong>{mode === 'demo' ? 'Тестовые события' : 'Рабочие события'}</strong>
                <p>
                  Показы: {total.impressions} · Добавления: {total.additions} · Ожидают реакции:{' '}
                  {total.pending}
                </p>
                {total.impressions === 0 && <p>Показов пока нет.</p>}
              </div>
            );
          })}
        </div>
      )}
      <p>
        Окно реакции — 30 минут. Эти счётчики описывают события, но без контрольной группы не
        измеряют эффект персонализации.
      </p>
      <button className="button secondary" onClick={() => setRefresh((n) => n + 1)}>
        Обновить результаты
      </button>
    </section>
  );
}
