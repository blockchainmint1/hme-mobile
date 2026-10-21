package money.honest.txcwallet;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HmeBiometricVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
