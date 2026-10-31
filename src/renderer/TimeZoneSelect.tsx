import {useEffect, useId, useMemo, useState, type KeyboardEvent} from 'react';
import {timeZoneOptions} from '../shared/timezones';
import {useI18n} from './i18n/provider';

export function TimeZoneSelect({value, disabled, onSelect}: {value: string; disabled: boolean; onSelect: (zone: string) => void}) {
  const {t} = useI18n();
  const listId = useId();
  const labelId = useId();
  const options = useMemo(() => timeZoneOptions(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => options.filter(option => option.id.toLowerCase().includes(needle)), [options, needle]);
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({block: 'nearest'});
  }, [open, activeIndex, listId]);

  function choose(zone: string) {
    onSelect(zone);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(Math.min(activeIndex + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter' && open && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return <div className="timezone-field">
    <span id={labelId} className="fingerprint-label">{t('Time zone')}</span>
    <div className="timezone-combo">
      <input
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        value={query}
        placeholder={value}
        disabled={disabled}
        onFocus={() => {setOpen(true); setQuery(''); setActive(Math.max(options.findIndex(option => option.id === value), 0));}}
        onBlur={() => {setOpen(false); setQuery('');}}
        onChange={event => {setQuery(event.target.value); setOpen(true); setActive(0);}}
        onKeyDown={onKeyDown}
      />
      {open && <ul id={listId} role="listbox" className="timezone-list" aria-labelledby={labelId} onMouseDown={event => event.preventDefault()}>
        {matches.length
          ? matches.map((option, index) => <li key={option.id} id={`${listId}-${index}`} role="option" aria-selected={option.id === value} className={index === activeIndex ? 'active' : ''} onMouseEnter={() => setActive(index)} onMouseDown={() => choose(option.id)}>
              <span>{option.id}</span><small>{option.offset}</small>
            </li>)
          : <li role="option" aria-disabled="true" aria-selected={false}>{t('No matching time zones')}</li>}
      </ul>}
    </div>
  </div>;
}
