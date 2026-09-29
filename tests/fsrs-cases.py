# Эталон для теста FSRS: последовательности ответов, посчитанные официальной библиотекой py-fsrs (pip install fsrs).
# Запуск: python3 tests/fsrs-cases.py out.json  (в тест кладутся первые 60 последовательностей)
import json, random, subprocess, sys
from datetime import datetime, timezone, timedelta
from fsrs import Scheduler, Card, Rating
random.seed(7)
sch = Scheduler(enable_fuzzing=False, maximum_interval=365)
cases = []
for k in range(300):
    seq = []; t = datetime(2026,1,1,tzinfo=timezone.utc); c = Card()
    for i in range(random.randint(1, 12)):
        # отвечаем в срок или с опозданием/раньше
        due = c.due
        t = max(t, due) + timedelta(minutes=random.choice([0,0,3,30,600,1440*random.randint(0,20)]))
        g = random.choice([1,2,3,3,3,4])
        c, _ = sch.review_card(c, Rating(g), t)
        seq.append({'t': t.timestamp()*1000, 'g': g, 's': c.stability, 'd': c.difficulty, 'due': c.due.timestamp()*1000, 'state': int(c.state), 'step': c.step})
    cases.append(seq)
json.dump(cases, open(sys.argv[1], 'w'))
