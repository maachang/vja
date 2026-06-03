# yaml概要

## yaml形式とは

　YAML（ヤムル）は、データを構造化して記述するためのデータ記述言語です。人間が直感的に読み書きしやすいよう設計されており、主にソフトウェアの設定ファイルやデータ交換、AIのプロンプトテンプレートなどで広く利用されています。

## yamlの特徴

- 高い可読性: 括弧やカンマを多用するJSONなどに比べてシンプルで、コードのように見やすく整理できます。
- 階層構造: インデント（半角スペース）を使って親子関係やデータの階層を表現します。
- コメントの利用: # を使って注釈やメモを残せるため、設定の意味を管理しやすいのが特徴です。

## yamlの記載例

### KeyValue定義.

```yaml
# 基本的なキーと値のペア
name: ユーザー名
age: 30
active: true
```

- 結果(JSONで説明)：

    ```json
    {
        "name": "ユーザ名",
        "age": 30,
        "active": true
    }
    ```

    このようなKeyValueが定義できる.

    yamlで一番基本的な記載方法がこの key, value であり、この記載に意味があることを頭に入れておくと、次からの内容を理解しやすくなる。

### リスト定義.

```yaml
# リスト（配列）の表現
skills:
    - Python
    - JavaScript
    - YAML
```

- 結果(JSONで説明):
    ```json
    { "skills": ["Python", "JavaScript", "YAML"] }
    ```
    このように、skills のキーに対して「複数のValueを設定する」場合はこのように定義ができる。

### 階層定義.

```yaml
# 階層構造（スペースなどのインデントで表現: pythonの階層構造と同じ）
company:
    name: Google
    location: Mountain View
    department:
        name: Cloud
        size: 200
```

- 結果(JSONで説明):

    ```json
    {
        "company": {
            "name": "Google",
            "location": "Mountain View",
            "department": {
                "name": "Cloud",
                "size": 200
            }
        }
    }
    ```

    階層構造にすることで、１つのkeyに対して、複数のKey,Value定義を定義する事できる。

    また「先ほどの配列」も同様に value として設定ができるようになる。

### 文字列に関する扱い

- 記載例：

    ```yaml
    openai:
        config: |
            url: http://127.0.0.1:8080
            apiKey: xxxxxxxxx
            users:
                - tanaka
                - suzuki
                - sato
            role: admin
        description: >
            接続先のコンフィグ情報の定義フォーマットを
            維持する場合は | で記載する。
            そうでない場合の長い文字列を定義する場合は
            > を利用する。
    ```

- 定義情報結果:
    - openai.config:
        ```
        url: http://127.0.0.1:8080
        apiKey: xxxxxxxxx
        users:
            - tanaka
            - suzuki
            - sato
        role: admin
        ```
    - openai.description:
        ```
        接続先のコンフィグ情報の定義フォーマットを維持する場合は | で記載する。そうでない場合の長い文字列を定義する場合は > を利用する。
        ```

- 説明：
    - openai.config では `>` これを value の初めに設定する事で、複数行で文字列を定義でき、一方で１行の文字列として記載ができる。
    - openai.description では `|` の記載があり、これは先程の `>` と似ているが「フォーマットを維持する」点で違っている。

## yamlの利用用途

　これと似た形の過去の構造化データのフォーマットとして

- XML
- JSON

　これらが存在するが、両方とも「コンピュータにとって扱いやすい」が `人間には扱いづらい` ものだったが、yamlによって、人が扱いやすい構造化データのフォーマットとして利用する事ができる。

　このyamlは、昨今のAI利用において、細かな指示を出すフォーマットとしても採用されており、vja においても `yaml` を利用するため、この基本知識としての説明を行っている。
